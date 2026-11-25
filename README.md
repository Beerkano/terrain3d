# Terrain Airsoft 3D

Éditeur de terrain hors ligne pour Windows x64, par beerkano.

Lancer `outputs/Terrain-Airsoft-3D-1.12.exe`. La carte démarre vide. Le bouton **Ouvrir La cour couverte** charge la carte intégrée. Le menu **Ouvrir** permet aussi de charger `outputs/La cour couverte.airsoft.json`.

**Visiter** ouvre une vue au sol à partir du point choisi sur la carte. Les flèches permettent de marcher et de tourner, et un glissement de souris oriente le regard. Échap ramène au plan.

## Développement

Depuis la racine du dépôt, exécuter `python work/assemble_desktop.py`, puis compiler avec PowerShell en suivant LISEZ-MOI.txt. Le code de l’interface et du rendu se trouve dans `work/`, et l’hôte Windows ainsi que le test intégré dans `work/airsoft-host/`.

Pour tester une compilation, lancer son exécutable avec `--self-test` et vérifier le code de sortie 0. Le test utilise un profil WebView2 temporaire.
