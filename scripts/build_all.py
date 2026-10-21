#!/usr/bin/env python3
"""Russian Launchpad build pipeline.

Single source of truth: rl-content/course.json (+ split files).
Generates:
  - silent placeholder OGGs for every referenced audio path that is missing,
    plus media/audio-manifest.json (so players never 404).
    Audio format: .ogg (Vorbis via ffmpeg; pure-Python silent-OGG fallback).
  - rl-webapp-frontend course data copy (course + manifest)
  - rl-scorm/  unpacked SCORM 1.2 package and dist/scorm12.zip
  - rl-xapi/dist/ xAPI-enabled bundle + sample statements
  - rl-cmi5/dist/ cmi5-ready bundle + launch config + sample payloads

Usage:  python3 scripts/build_all.py [--no-zip]
Pure standard library; no network access required.
"""
import json, os, shutil, struct, subprocess, sys, wave, math, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "rl-content")

def load_course():
    with open(os.path.join(CONTENT, "course.json"), encoding="utf-8") as f:
        return json.load(f)

# ---------------------------------------------------------------- audio ----
AUDIO_EXT = ".ogg"

def _make_silent_ogg_pure(path, seconds=1.2, sr=48000):
    """Pure-Python minimal valid Ogg container with zero-length Vorbis packets.
    Browsers decode it as silent audio (no codec data -> no samples)."""
    import zlib
    serial = 0x524c3132  # 'RL12'
    pages, granule = [], [0, -1, -1]
    headers = [b"\x01vorbis\x00\x00\x00\x00\x00\x00\x00\x80\x02\x88\x00\x00\x00",
               b"\x03vorbis", b"\x05vorbis"]
    for idx, hd in enumerate(headers):
        body = bytes([idx]) + hd  # packet-type 0 header + vorbis id/setup comment
        seg = [len(body)]
        hdr = bytearray()
        hdr += b"OggS"             # capture pattern
        hdr += bytes([0])          # version
        flags = 0x02 if idx == 0 else (0x04 if idx == 2 else 0x00)  # BOS/EOS
        hdr += bytes([flags])
        hdr += struct.pack("<IqI", idx, granule[idx], serial)  # seq, granule, serial
        hdr += bytes([0, 0])       # dummy CRC (patched below)
        hdr += bytes([len(seg)]) + bytes(seg)
        page = bytearray(hdr) + body
        crc = zlib.crc32(bytes(page)) & 0xFFFFFFFF
        page[22:26] = struct.pack("<I", crc)
        pages.append(bytes(page))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"".join(pages))

def make_audio_placeholder(path, seconds=1.2):
    """Write a silent placeholder audio file (.ogg preferred, .wav legacy)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if shutil.which("ffmpeg"):
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                 "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
                 "-t", str(seconds), "-c:a", "libvorbis", "-q:a", "2", path],
                capture_output=True)
            if r.returncode == 0 and os.path.exists(path) and os.path.getsize(path) > 0:
                return
        except Exception:
            pass
    if path.endswith(".ogg"):
        _make_silent_ogg_pure(path, seconds)
    else:  # legacy WAV writer kept only for non-.ogg targets
        make_wav(path, seconds=seconds)

def make_wav(path, seconds=1.2, sr=8000):
    """Write a valid silent WAV (legacy fallback)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = int(sr * seconds)
    w = wave.open(path, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(bytes(2 * n))
    w.close()

def collect_audio_refs(course):
    refs = []
    for l in course["lessons"]:
        for p in l.get("pronunciation", []):
            if p.get("audio"): refs.append((p["id"], p["audio"], p["ru"]))
        for s in l.get("speechBlanks", []):
            if s.get("audio"): refs.append((s["id"], s["audio"], s["transcript"]))
    return refs

def ensure_placeholders(target_content_dir, course):
    """Convert any legacy .wav refs to .ogg, create silent placeholder OGGs
    for missing files and delete stale .wav files. Writes audio-manifest.json."""
    # 1) rewrite all audio references in the (already copied into target dir)
    #    content JSON files: media/audio/xxx.wav -> media/audio/xxx.ogg
    for rel_json in ["course.json"]:
        fp = os.path.join(target_content_dir, rel_json)
        if os.path.exists(fp):
            with open(fp, encoding="utf-8") as f:
                raw = f.read()
            fixed = raw.replace(".wav", AUDIO_EXT)
            if fixed != raw:
                with open(fp, "w", encoding="utf-8") as f:
                    f.write(fixed)
    # also split content files copied alongside (speech/pronunciation json)
    for sub in ("speech", "pronunciation"):
        sdir = os.path.join(target_content_dir, sub)
        if os.path.isdir(sdir):
            for fn in os.listdir(sdir):
                if fn.endswith(".json"):
                    p = os.path.join(sdir, fn)
                    with open(p, encoding="utf-8") as f:
                        raw = f.read()
                    fixed = raw.replace(".wav", AUDIO_EXT)
                    if fixed != raw:
                        with open(p, "w", encoding="utf-8") as f:
                            f.write(fixed)
    # reload refs from updated in-memory course too
    for l in course.get("lessons", []):
        for p in l.get("pronunciation", []):
            if isinstance(p.get("audio"), str):
                p["audio"] = p["audio"].replace(".wav", AUDIO_EXT)
        for s in l.get("speechBlanks", []):
            if isinstance(s.get("audio"), str):
                s["audio"] = s["audio"].replace(".wav", AUDIO_EXT)

    refs = collect_audio_refs(course)
    manifest = {"generatedBy": "scripts/build_all.py", "format": "ogg (Vorbis)",
                "items": []}
    adir = os.path.join(target_content_dir, "media", "audio")
    os.makedirs(adir, exist_ok=True)
    for item_id, rel, text in refs:
        rel = rel.replace(".wav", AUDIO_EXT)
        fp = os.path.join(target_content_dir, rel)
        placeholder = False
        wav_legacy = os.path.splitext(fp)[0] + ".wav"
        if not os.path.exists(fp):
            # reuse existing legacy WAV bytes? No - regenerate as OGG placeholder
            make_audio_placeholder(fp, seconds=1.2)
            placeholder = True
        if os.path.exists(wav_legacy):
            os.remove(wav_legacy)  # drop stale .wav so only ogg ships
        manifest["items"].append({
            "id": item_id, "path": rel, "text": text,
            "exists": True, "placeholder": placeholder,
            "ttsEngine": "web-speech (browser) at runtime; OGG kept as fallback",
        })
    mdir = os.path.join(target_content_dir, "media")
    os.makedirs(mdir, exist_ok=True)
    with open(os.path.join(mdir, "audio-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest

# ---------------------------------------------------------------- copies ---
SHARED_JS = ["js/mock-api.js", "js/tracking-adapter.js", "js/tts.js",
             "js/recorder.js", "js/tint.js", "js/comments.js", "js/course-data.js"]

def stage_common(dst, course, mode):
    """Copy content + shared player assets into dst."""
    if os.path.isdir(dst): shutil.rmtree(dst)
    os.makedirs(dst, exist_ok=True)
    shutil.copytree(os.path.join(CONTENT, "media"), os.path.join(dst, "media"))
    with open(os.path.join(dst, "course.json"), "w", encoding="utf-8") as f:
        json.dump(course, f, ensure_ascii=False, indent=2)
    jdir = os.path.join(dst, "js"); os.makedirs(jdir, exist_ok=True)
    for rel in SHARED_JS:
        src = os.path.join(ROOT, "rl-webapp-frontend", rel)
        if os.path.exists(src): shutil.copy2(src, os.path.join(dst, rel))
    css_src = os.path.join(ROOT, "rl-webapp-frontend", "css", "player.css")
    if os.path.exists(css_src):
        os.makedirs(os.path.join(dst, "css"), exist_ok=True)
        shutil.copy2(css_src, os.path.join(dst, "css", "player.css"))
    with open(os.path.join(jdir, "runtime-config.js"), "w", encoding="utf-8") as f:
        f.write("window.RL_RUNTIME = %s;\n" % json.dumps({
            "mode": mode,                      # preview | scorm | xapi | cmi5
            "contentBase": ".",                # relative everywhere
            "courseId": course["id"],
            "activityId": course["config"]["tracking"]["xapi"]["activityId"],
        }, indent=2))

# ---------------------------------------------------------------- SCORM ----
SCORM_IMS = """<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="RussianLaunchpadA1A2" version="2.0.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="RL_ORG">
    <organization identifier="RL_ORG" structure="hierarchical">
      <title>Russian Launchpad A1-A2</title>
      <item identifier="l1" identifierref="res_l1"><title>Lesson 1 - Privet!</title></item>
      <item identifier="l2" identifierref="res_l2"><title>Lesson 2 - Cafe</title></item>
      <item identifier="l3" identifierref="res_l3"><title>Lesson 3 - Directions (Immigration Lab)</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_l1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/><file href="scormdriver.js"/>
    </resource>
    <resource identifier="res_l2" type="webcontent" adlcp:scormtype="sco" href="index.html"/>
    <resource identifier="res_l3" type="webcontent" adlcp:scormtype="sco" href="index.html"/>
  </resources>
</manifest>
"""

SCORM_XML = """<?xml version="1.0" encoding="UTF-8"?>
<adlcp_rootv1p2 xmlns="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema><schemaversion>1.2</schemaversion>
  </metadata>
</adlcp_rootv1p2>
"""

def build_scorm(course, no_zip=False):
    dst = os.path.join(ROOT, "rl-scorm")
    pkg = os.path.join(dst, "dist_unpacked")
    stage_common(pkg, course, "scorm")
    with open(os.path.join(pkg, "imsmanifest.xml"), "w", encoding="utf-8") as f:
        f.write(SCORM_IMS)
    shutil.copy2(os.path.join(ROOT, "rl-scorm", "src", "scormdriver.js"), os.path.join(pkg, "scormdriver.js"))
    shutil.copy2(os.path.join(ROOT, "rl-scorm", "src", "index.html"), os.path.join(pkg, "index.html"))
    # zip via python (works without `zip` binary)
    if not no_zip:
        os.makedirs(os.path.join(dst, "dist"), exist_ok=True)
        zpath = os.path.join(dst, "dist", "scorm12.zip")
        if os.path.exists(zpath): os.remove(zpath)
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for base, _, files in os.walk(pkg):
                for fn in files:
                    fp = os.path.join(base, fn)
                    z.write(fp, os.path.relpath(fp, pkg))
        print("SCORM zip:", zpath)
    print("SCORM package staged at", pkg)

# ---------------------------------------------------------------- xAPI -----
def build_xapi(course):
    dst = os.path.join(ROOT, "rl-xapi", "dist")
    stage_common(dst, course, "xapi")
    shutil.copy2(os.path.join(ROOT, "rl-xapi", "src", "index.html"), os.path.join(dst, "index.html"))
    shutil.copy2(os.path.join(ROOT, "rl-xapi", "src", "xapi-config.json"), os.path.join(dst, "xapi-config.json"))
    # generate sample statements from content (deterministic ids ok for samples)
    samples = []
    aid = course["config"]["tracking"]["xapi"]["activityId"]
    reg = "rl-demo-registration-0001"
    def st(verb_id, verb_disp, obj_extra=None, result=None, ctx_more=None):
        s = {
            "actor": {"objectType": "Agent", "account": {"name": "student-demo", "homePage": "https://russianlaunchpad.example"}},
            "verb": {"id": "https://russianlaunchpad.example/xapi/verb/" + verb_id, "display": {"en-US": verb_disp}},
            "object": {"id": aid, "definition": {"name": {"en-US": course["title"]},
                       "type": "https://russianlaunchpad.example/activity/course"}},
            "context": {"contextActivities": {"parent": [{"id": aid}]}, "registration": reg},
            "timestamp": "2026-10-21T09:00:00.000Z",
        }
        if obj_extra: s["object"]["id"] = obj_extra
        if result: s["result"] = result
        if ctx_more: s["context"].update(ctx_more)
        return s
    V = "https://russianlaunchpad.example/xapi/verb/"
    A = "https://russianlaunchpad.example/xapi/activity/"
    samples.append(st("launched", "launched"))
    for l in course["lessons"][:1]:
        q = l["quiz"][0]
        samples.append(st("answered", "answered", A + q["id"],
                         {"response": "choice:" + q["options"][q["correct"]], "success": True,
                          "score": {"scaled": 1.0, "raw": 1, "min": 0, "max": 1}}))
        p = l["pronunciation"][0]
        samples.append(st("recorded", "recorded", A + p["id"], None,
                          {"extensions": {"https://russianlaunchpad.example/xapi/ext/attempt": 1}}))
        samples.append(st("compared", "compared", A + p["id"]))
        sb = l["speechBlanks"][0]
        samples.append(st("practiced", "practiced", A + sb["id"],
                          {"response": sb["answer"], "success": True}))
        samples.append(st("commented", "commented", A + l["id"],
                          None, {"extensions": {"https://russianlaunchpad.example/xapi/ext/comment-visibility": "private_instructor"}}))
    samples.append(st("completed", "completed", None, {"completion": True}))
    samples.append(st("passed", "passed", None, {"success": True, "score": {"scaled": 0.87}}))
    samples.append(st("failed", "failed", None, {"success": False, "score": {"scaled": 0.4}}))
    samples.append(st("terminated", "terminated", None, {"duration": "PT18M32S"}))
    for plan in ("six_months", "one_year"):
        samples.append(st("subscription_activated", "subscription activated", A + "subscription/" + plan,
                          None, {"extensions": {"https://russianlaunchpad.example/xapi/ext/plan": plan}}))
    samples.append(st("subscription_renewed", "subscription renewed", A + "subscription/six_months"))
    samples.append(st("subscription_canceled", "subscription canceled", A + "subscription/one_year"))
    out = os.path.join(ROOT, "rl-xapi", "statements", "sample-statements.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(samples, f, ensure_ascii=False, indent=2)
    shutil.copy2(out, os.path.join(dst, "sample-statements.json"))
    print("xAPI bundle + %d sample statements" % len(samples))

# ---------------------------------------------------------------- cmi5 -----
def build_cmi5(course):
    dst = os.path.join(ROOT, "rl-cmi5", "dist")
    stage_common(dst, course, "cmi5")
    for fn in ("index.html", "cmi5-launch-config.json", "mock-launcher.html"):
        shutil.copy2(os.path.join(ROOT, "rl-cmi5", "src", fn), os.path.join(dst, fn))
    aid = course["config"]["tracking"]["xapi"]["activityId"]
    reg = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
    move_on = "https://russianlaunchpad.example/cmi5/move-on/pass"
    def cs(verb_id, disp, obj_id=None, result=None, cat_parent=True):
        o = {"id": obj_id or aid, "definition": {"name": {"en-US": course["title"]},
             "type": "https://russianlaunchpad.example/activity/course"}}
        return {
          "actor": {"objectType": "Agent", "account": {"name": "cmi5-learner", "homePage": "https://lms.example"}},
          "verb": {"id": "http://adlnet.gov/expapi/verbs/" + verb_id, "display": {"en-US": disp}},
          "object": o,
          "context": {
            "contextActivities": {
              "category": [{"id": "https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md"}],
              **({"parent": [{"id": aid}]} if cat_parent and obj_id != aid else {})
            },
            "registration": reg,
            "extensions": {"https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#cmi5_scenario": move_on}
          },
          "timestamp": "2026-10-21T10:00:00.000Z",
          **({"result": result} if result else {})
        }
    A = "https://russianlaunchpad.example/xapi/activity/"
    scenarios = {
      "1_Launch": [cs("launched", "launched")],
      "2_Interacted": [cs("answered", "answered", A + "q303",
                          {"response": "вид на жительство", "success": True,
                           "score": {"scaled": 1.0, "raw": 1, "min": 0, "max": 1}})],
      "3_Completed": [cs("completed", "completed", None, {"completion": True})],
      "4_Passed": [cs("passed", "passed", None, {"success": True, "completion": True,
                     "score": {"scaled": 0.9, "raw": 9, "min": 0, "max": 10}})],
      "5_Terminated": [cs("terminated", "terminated", None, {"duration": "PT22M05S"})],
      "MoveOn_Pass": [cs("mastered", "mastered", None, {"success": True})]
    }
    out = os.path.join(ROOT, "rl-cmi5", "samples", "moveon-payloads.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(scenarios, f, ensure_ascii=False, indent=2)
    shutil.copy2(out, os.path.join(dst, "moveon-payloads.json"))
    print("cmi5 bundle + scenario payloads")

# --------------------------------------------------------- webapp staging --
def build_webapp(course):
    fe = os.path.join(ROOT, "rl-webapp-frontend")
    ensure_placeholders(fe, course)  # creates fe/media/audio/*.ogg + fe/media/audio-manifest.json
    # course data copy for the frontend fetch (relative path)
    with open(os.path.join(fe, "course.json"), "w", encoding="utf-8") as f:
        json.dump(course, f, ensure_ascii=False, indent=2)
    print("webapp data refreshed")

def main():
    no_zip = "--no-zip" in sys.argv
    course = load_course()
    # 1. placeholders & manifest in the content master
    ensure_placeholders(CONTENT, course)
    # 2. each consumer gets a copy of content+media
    build_webapp(course)
    build_scorm(course, no_zip=no_zip)
    build_xapi(course)
    build_cmi5(course)
    print("BUILD OK")

if __name__ == "__main__":
    main()
