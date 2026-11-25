# Terrain Airsoft 3D

Éditeur de terrain hors ligne pour Windows x64, par beerkano.

Lancer `outputs/Terrain-Airsoft-3D-1.10.exe`. La carte démarre vide. Le menu **Ouvrir** permet de charger `outputs/La cour couverte.airsoft.json`.

## Développement

Depuis la racine du dépôt, exécuter `python work/assemble_desktop.py`, puis compiler avec PowerShell en suivant LISEZ-MOI.txt. Le code de l’interface et du rendu se trouve dans `work/`, et l’hôte Windows ainsi que le test intégré dans `work/airsoft-host/`.

Pour tester une compilation, lancer son exécutable avec `--self-test` et vérifier le code de sortie 0. Le test utilise un profil WebView2 temporaire.
