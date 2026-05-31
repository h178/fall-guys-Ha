# IA Edition Game - Fall Guys Clone

**Équipe : GAME**

Bienvenue dans notre soumission pour le concours **Games on Web - IA Edition** ! 
J'ai développé ce jeu multijoueur compétitif en 3D inspiré de Fall Guys en tant que développeur solo, où les joueurs s'affrontent sur différents parcours parsemés d'obstacles physiques.

## 👤 Membre de l'équipe
- **Yassine HATTABI** (Développement complet : Gameplay, Architecture Réseau, Intégration 3D et Moteur Physique)

## 🎥 Vidéo & Jouabilité
- **Vidéo de Présentation :** *(La vidéo sera uploadée demain sur YouTube, le lien final sera inséré ici)*
- **Jouer en Ligne :** *(En cours de déploiement. En attendant, les instructions pour le faire tourner en local parfaitement sont à la fin de ce fichier)*

## 🧠 Respect du Thème "IA Edition"
Pour moi, l'IA Edition a pris un sens très littéral et concret. L'Intelligence Artificielle n'a pas seulement été un thème, mais un véritable **coéquipier de développement**. J'ai utilisé des assistants IA en pair-programming pour concevoir des architectures complexes (synchronisation réseau à faible latence, résolution de conflits avec le moteur physique). 
Dans le contexte du jeu, l'environnement se veut dynamique : la génération et la sélection des niveaux s'adaptent, créant une arène où l'imprévisibilité règne.

## 🎮 Contrôles (Compatibilité Internationale)
Le jeu se joue entièrement au clavier et à la souris. 
- **Clavier :** Déplacement du personnage. J'ai pensé à nos amis américains et au jury ! Le jeu supporte nativement les claviers **QWERTY (WASD)** et **AZERTY (ZQSD)**.
- **Souris :** Contrôle total de la caméra orbitale (360°).
- **Saut :** Barre Espace.

*(Aucun gamepad ou matériel spécifique n'est requis. Fonctionne parfaitement sur ordinateur portable).*

## 📖 Contexte et Narration In-Game
Dès le début de l'expérience, les joueurs sont plongés dans une salle d'attente (Lobby) en apesanteur où l'enjeu est clair : se qualifier ou être éliminé. L'interface "WAITING" et la grille de départ posent le contexte d'une course impitoyable. Une **musique procédurale** (générée dynamiquement en JavaScript) s'enclenche avec un "beat" qui s'accélère durant les 5 secondes du compte à rebours, faisant monter l'adrénaline juste avant le "GO!".

## 🏗️ L'Histoire du Développement & Galères

### Les premiers prototypes
Le projet a débuté par un simple cube gris qui glissait sur un plan plat. Très vite, j'ai intégré un modèle 3D animé (`HVGirl.glb`), mais la complexité a explosé lors du passage au multijoueur.

### Mes Galères
Le fameux **Bug du Totem** : Au début, tous les joueurs apparaissaient au même point exact (X=0, Y=2, Z=0). Conséquence ? Le moteur physique (Havok) paniquait en voyant 10 corps fusionnés et les expulsait verticalement, créant un empilement de joueurs en "Totem" très comique mais injouable. 

### Décisions de conception et Fiertés
- **L'Anti-Totem :** J'ai résolu le bug du totem en développant un algorithme de grille déterministe. Chaque client trie la liste des joueurs connectés et calcule sa position exacte dans une file indienne.
- **Musique Procédurale (Zéro Fichier Audio) :** Au lieu de dépendre de fichiers MP3 sujets aux erreurs réseau (404/CORS), j'ai codé un synthétiseur complet en utilisant l'API Web Audio native qui simule un "Kick drum" dont le BPM accélère en temps réel.

## ⚙️ Challenges Techniques relevés
Mon plus grand défi a été l'intégration de trois technologies lourdes en parfaite synergie :
1. **BabylonJS v7** (Rendu WebGL 3D, Ombres dynamiques PBR).
2. **Havok Physics** (Moteur physique de pointe en WebAssembly).
3. **Colyseus** (Serveur NodeJS autoritaire).

J'ai réussi à **synchroniser les rotations via Quaternions (Slerp)** pour tous les joueurs distants tout en gardant une fréquence de rafraîchissement réseau basse pour économiser la bande passante, le tout sans effet de "moonwalk" sur les animations.

## 🚀 Lancer le projet en local
Si vous souhaitez tester l'architecture en local (nécessite Node.js) :
```bash
# 1. Lancer le serveur (Port 2567)
cd server
npm install
npm run dev

# 2. Lancer le client (Port 5173)
cd ../client
npm install
npm run dev
```
