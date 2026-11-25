#!/usr/bin/env python3
"""
ออกเวอร์ชันใหม่ของ MayProtein POS (รันทุกครั้งก่อน commit การแก้ไข)

  python3 tools/release.py "สรุปสิ่งที่แก้"

สิ่งที่ทำ:
  1. สำรองเวอร์ชันปัจจุบัน (ไฟล์ใน commit ล่าสุด = เวอร์ชันก่อนแก้) ไว้ที่ versions/v<เลข>/
     เปิดใช้ได้ที่ https://jsungkapo.github.io/mayprotein-pos/versions/v<เลข>/
  2. เก็บสำรองไว้แค่ 3 เวอร์ชันล่าสุด ลบที่เก่ากว่า
  3. เพิ่มเลขเวอร์ชัน + บันทึกการเปลี่ยนแปลงใน version.js
  4. เปลี่ยน ?v= ท้ายไฟล์ js/css ใน index.html / admin.html และ SERVER_VERSION ใน apps-script/Code.gs

สร้างสำรองจาก commit ที่ระบุ (ใช้ครั้งแรก):  python3 tools/release.py --snapshot 1.9 11b30b3
"""
import json, os, re, shutil, subprocess, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = 3
FILES = ['index.html', 'admin.html', 'styles.css', 'config.js', 'api.js', 'offline.js', 'requisition.js',
         'report.js', 'receipt.js', 'version.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
         'icons/apple-touch-icon.png', 'apps-script/Code.gs']


def git(*a, binary=False):
    out = subprocess.run(['git', '-C', ROOT] + list(a), capture_output=True, check=False)
    return out.stdout if binary else out.stdout.decode('utf8')


def read_version():
    s = open(os.path.join(ROOT, 'version.js'), encoding='utf8').read()
    return json.loads(s[s.index('{'):s.rindex('}') + 1])


def write_version(v):
    body = json.dumps(v, ensure_ascii=False, indent=2)
    open(os.path.join(ROOT, 'version.js'), 'w', encoding='utf8').write(
        '// สร้างโดย tools/release.py — อย่าแก้มือ\nwindow.APP_VERSION = ' + body + ';\n')


def vkey(name):
    return tuple(int(x) for x in re.findall(r'\d+', name))


def snapshot(ver, commit):
    dest = os.path.join(ROOT, 'versions', 'v' + ver)
    if os.path.exists(dest):
        shutil.rmtree(dest)
    for f in FILES:
        data = git('show', f'{commit}:{f}', binary=True)
        if not data:
            continue
        p = os.path.join(dest, f)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if f.endswith('.html'):
            s = data.decode('utf8')
            # หน้าสำรองไม่ต้องติดตั้งตัวเก็บไฟล์ออฟไลน์ และแสดงแถบบอกว่าเป็นเวอร์ชันเก่า
            s = s.replace("navigator.serviceWorker.register('sw.js')", "Promise.resolve()")
            s = s.replace('<body>', f'<body><div style="background:#333;color:#fff;font:600 13px sans-serif;padding:6px 12px;text-align:center">'
                                    f'เวอร์ชันสำรอง v{ver} (ข้อมูลเดียวกับระบบจริง) · <a href="../../{f}" style="color:#9cf">กลับเวอร์ชันล่าสุด</a></div>', 1)
            data = s.encode('utf8')
        open(p, 'wb').write(data)
    if not os.path.exists(os.path.join(dest, 'version.js')):
        open(os.path.join(dest, 'version.js'), 'w', encoding='utf8').write(
            'window.APP_VERSION = ' + json.dumps({'version': ver, 'date': '', 'notes': ''}, ensure_ascii=False) + ';\n')
    print('สำรอง v' + ver + ' จาก ' + commit[:7])


def prune():
    vdir = os.path.join(ROOT, 'versions')
    if not os.path.isdir(vdir):
        return []
    names = sorted([n for n in os.listdir(vdir) if n.startswith('v')], key=vkey, reverse=True)
    for old in names[KEEP:]:
        shutil.rmtree(os.path.join(vdir, old))
        print('ลบสำรองเก่า', old)
    return [n[1:] for n in names[:KEEP]]


def stamp(ver):
    tag = ver
    for f in ['index.html', 'admin.html']:
        p = os.path.join(ROOT, f)
        s = open(p, encoding='utf8').read()
        s = re.sub(r'(src="(?:config|api|requisition|report|receipt|offline|version)\.js|href="styles\.css)(\?v=[^"]*)?"', r'\1?v=' + tag + '"', s)
        open(p, 'w', encoding='utf8').write(s)
    p = os.path.join(ROOT, 'apps-script', 'Code.gs')
    s = open(p, encoding='utf8').read()
    s = re.sub(r"const SERVER_VERSION = '[^']*';", f"const SERVER_VERSION = '{ver}';", s)
    open(p, 'w', encoding='utf8').write(s)


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == '--snapshot':
        snapshot(sys.argv[2], sys.argv[3])
        v = read_version(); v['backups'] = prune(); write_version(v)
        return
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    notes = sys.argv[1]
    v = read_version()
    cur = v['version']
    snapshot(cur, 'HEAD')
    major, minor = cur.split('.')
    new = f'{major}.{int(minor) + 1}'
    today = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=7)
    v['history'].insert(0, {'version': new, 'date': today.strftime('%Y-%m-%d %H:%M'), 'notes': notes})
    v['version'], v['date'], v['notes'] = new, today.strftime('%Y-%m-%d %H:%M'), notes
    v['history'] = v['history'][:40]
    v['backups'] = prune()
    write_version(v)
    stamp(new)
    print('เวอร์ชันใหม่ v' + new)


if __name__ == '__main__':
    main()
