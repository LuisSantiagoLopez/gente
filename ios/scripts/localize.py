# Fills the string catalogs from the build's .stringsdata plus translations.py.
# Usage: python3 scripts/localize.py <derivedData>
import glob, json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from translations import T, INFOPLIST
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dd = sys.argv[1]
keys = set()
for f in glob.glob(f'{dd}/Build/Intermediates.noindex/Gente.build/Debug-iphonesimulator/Gente.build/Objects-normal/arm64/*.stringsdata'):
    for t, arr in json.load(open(f)).get('tables', {}).items():
        if t == 'Localizable':
            keys.update(e['key'] for e in arr)
keys.update(k for k in T)  # strings passed as values (services, carries) are not extracted
def unit(v): return {"stringUnit": {"state": "translated", "value": v}}
cat = {"sourceLanguage": "en", "strings": {}, "version": "1.0"}
missing = []
for k in sorted(keys):
    if k.strip() == "" or k in ("Gente", "%@%@", "Pro", "Max", "Max Plus") or k.startswith("Gente %@"):
        cat["strings"][k] = {"shouldTranslate": False}; continue
    if k not in T: missing.append(k); continue
    es, pt = T[k]
    cat["strings"][k] = {"localizations": {"es": unit(es), "pt-BR": unit(pt)}}
json.dump(cat, open(f'{root}/Gente/Resources/Localizable.xcstrings', 'w'), indent=2, ensure_ascii=False)
ip = {"sourceLanguage": "en", "strings": {}, "version": "1.0"}
for k, (en, es, pt) in INFOPLIST.items():
    ip["strings"][k] = {"localizations": {"en": unit(en), "es": unit(es), "pt-BR": unit(pt)}}
json.dump(ip, open(f'{root}/Gente/Resources/InfoPlist.xcstrings', 'w'), indent=2, ensure_ascii=False)
print("strings", len(cat["strings"]), "missing", len(missing))
for m in missing: print("MISSING:", m)
