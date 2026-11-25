from pathlib import Path
import re

work = Path(__file__).resolve().parent
read = lambda name: (work / name).read_text(encoding='utf-8')
fragment = read('airsoft-fragment.html')
fragment = re.sub(r'<style>.*?</style>', '', fragment, flags=re.S)
fragment = re.sub(r'\s*<button[^>]*id="ate-save".*?</button>', '', fragment)
fragment = re.sub(r'\s*<div id="ate-plan-panel" hidden>.*?id="ate-load-status".*?</div>', '', fragment, flags=re.S)
focus_button = '<button class="btn btn-ghost" type="button" id="ate-focus-marche">Marché est</button>'
assert focus_button in fragment
fragment = fragment.replace(focus_button, focus_button + '\n    <button class="btn btn-ghost" type="button" id="ate-square" title="Remettre les quatre conteneurs et la bâche à leur place initiale">Reformer le carré</button>')
for token, filename in [('RENDERER','airsoft-renderer.js'),('LAYOUT','airsoft-layout-v2.js'),('UI','airsoft-ui.js')]:
    fragment = fragment.replace(f'/* AIRSOFT_{token} */', read(filename))
fragment=fragment.replace('/* Dependency-free',read('desktop-design.js')+'\n/* Dependency-free',1)
fragment=fragment.replace('class="text-small text-muted">100 × 160 m','id="ate-land-info" class="text-small text-muted">100 × 160 m',1)
fragment=fragment.replace('<div class="ate-properties">','<div class="ate-properties"><label class="form-label">Couleur de l’objet<input id="ate-color" type="color" class="form-control"></label>')
fragment=fragment.replace('<span id="ate-error"','''<details><summary>Dimensions et couleur du terrain</summary><div class="ate-properties"><label class="form-label">Largeur (m)<input class="form-control" id="ate-land-width" type="number" min="40" max="500"></label><label class="form-label">Longueur (m)<input class="form-control" id="ate-land-depth" type="number" min="40" max="500"></label><label class="form-label">Couleur du sol<input class="form-control" id="ate-land-ground" type="color"></label></div></details><span id="ate-error"''')
fragment=fragment.replace('id="ate-add">Ajouter</button>','id="ate-add">Ajouter</button><button type="button" class="btn" id="ate-design">Créer un objet</button>')
fragment=fragment.replace('<div class="viz-row ate-actions">','<div id="ate-door-tools" hidden><label class="form-label">Mur de la porte<select class="form-select" id="ate-door-wall"></select></label><button type="button" class="btn" id="ate-door">Ajouter une porte</button></div><div class="viz-row ate-actions">',1)
fragment=fragment.replace('/* DESKTOP DRAWING */',read('desktop-drawing.js').replace('/* WALKTHROUGH */',read('desktop-visit.js')))
shell = read('airsoft-desktop-shell.html')
tools_bar=''.join(f'<button type="button" class="btn" id="ate-{key}" aria-pressed="false">{label}</button>' for key,label in [('explore','Explorer'),('move','Déplacer'),('turn','Tourner'),('measure','Mesurer'),('visit','Visiter')])
fragment=fragment.replace('<button type="button" class="btn" id="ate-measure" aria-pressed="false">Mesurer</button>','')
fragment=fragment.replace('<div class="viz-row ate-locations"', '<div class="ate-navigation"><div class="ate-tools viz-row" role="group" aria-label="Outil actif">'+tools_bar+'</div><div class="viz-row ate-locations"')
fragment=fragment.replace('<canvas id="ate-canvas"', '</div><canvas id="ate-canvas"',1)
fragment=fragment.replace('<div class="viz-row ate-actions">','<div id="ate-outline-wrap" hidden><label class="form-label">Sommets du contour (X,Z de 0 à 100 %, séparés par un point-virgule)<textarea class="form-control" id="ate-outline" rows="2"></textarea></label><button type="button" class="btn" id="ate-outline-apply">Appliquer le contour</button></div><div class="viz-row ate-actions">',1)
# Retain the shared object fields and model options in the desktop inspector.
panel_start=fragment.index('<div class="ate-bottom">')
panel_end=fragment.index('</div>\n</div>',panel_start)+len('</div>')
panel=fragment[panel_start:panel_end]
inspector=read('desktop-inspector.html')
for key,pattern in {
    'catalog':r'id="ate-add-type">(.*?)</select>',
    'rotation':r'(<div class="viz-row" id="ate-turn-tools".*?</div>)',
    'properties':r'(<fieldset.*?</fieldset>)',
    'land':r'(<details>.*?</details>)'
}.items():
    inspector=inspector.replace('{{'+key+'}}',re.search(pattern,panel,re.S).group(1))
fragment=fragment[:panel_start]+inspector+fragment[panel_end:]
fragment=fragment.replace('</div><canvas id="ate-canvas"', '<div class="scene-help"><span id="ate-hint"></span><span id="ate-measure-note" role="status"></span></div></div><canvas id="ate-canvas"',1)
# Project controls share a header so file actions fit on one line.
fragment=fragment.replace('<h2>Ton terrain d’airsoft</h2>','<h2>Terrain Airsoft <span>3D</span></h2>')
fragment=fragment.replace('>Reformer le carré</button>','>Restaurer la cour</button>')
fragment=re.sub(r'<button[^>]*id="ate-focus-(cour|atelier|marche)"[^>]*>.*?</button>', '', fragment)
square=re.search(r'<button[^>]*id="ate-square".*?</button>',fragment).group()
fragment=fragment.replace(square,'',1).replace('<button class="btn" id="ate-png">',square+'<button class="btn" id="ate-png">',1)
for key,shortcut in [('undo','Ctrl+Z'),('redo','Ctrl+Maj+Z')]:
    fragment=fragment.replace(f'id="ate-{key}"',f'id="ate-{key}" title="{shortcut}"',1)
for token, value in [('APP_FRAGMENT',fragment),('APP_CSS',read('airsoft-desktop.css')),('APP_STORAGE',read('airsoft-desktop-storage.js'))]:
    mark = f'<!-- {token} -->'
    assert shell.count(mark) == 1, mark
    shell = shell.replace(mark,value)
(work / 'airsoft-desktop.html').write_text(shell, encoding='utf-8')
