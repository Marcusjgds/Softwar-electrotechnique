# 🚀 Softwar Elec — Guide de déploiement

## 📁 Structure du projet
```
softwar-elec/
├── server.js          ← Backend Node.js + WebSockets + IA
├── package.json
├── render.yaml        ← Config Render automatique
├── .gitignore
└── public/
    └── index.html     ← Frontend complet
```

---

## ✅ Étape 1 — GitHub

1. Créez un nouveau repo sur [github.com](https://github.com/new)
   - Nom : `softwar-elec`
   - Visibilité : **Public** (ou privé)

2. Uploadez tous les fichiers :
   - Cliquez **"uploading an existing file"**
   - Glissez tous les fichiers (server.js, package.json, render.yaml, .gitignore, et le dossier public/)

---

## ✅ Étape 2 — Render

1. Allez sur [render.com](https://render.com) → **New Web Service**
2. Connectez votre repo GitHub `softwar-elec`
3. Render détecte automatiquement `render.yaml`
4. Configurez les variables d'environnement :

| Variable | Valeur |
|----------|--------|
| `ANTHROPIC_API_KEY` | Votre clé sur [console.anthropic.com](https://console.anthropic.com) |
| `SESSION_SECRET` | Auto-généré par Render |

5. Cliquez **Deploy** — votre site sera en ligne en 2-3 minutes !

---

## 🔑 Compte admin par défaut
- **Nom d'utilisateur :** `Admin`  
- **Mot de passe :** `Admin1234!`

⚠️ Changez ce mot de passe après la première connexion !

---

## 🤖 Activer l'IA
1. Créez un compte sur [console.anthropic.com](https://console.anthropic.com)
2. Générez une clé API
3. Ajoutez-la dans Render → Environment → `ANTHROPIC_API_KEY`

---

## 💬 Fonctionnalités
- ✅ Inscription / connexion sécurisée (bcrypt)
- ✅ Chat en temps réel (WebSockets) avec de vraies personnes
- ✅ Messages privés (DM)
- ✅ Envoi d'images, vidéos, messages vocaux
- ✅ Rôles : Admin / Professeur / Élève / Premium+
- ✅ Espace Admin : voir tous les utilisateurs, changer les rôles, annonces
- ✅ Devoirs épinglés (professeur)
- ✅ Assistant IA (Claude) intégré
- ✅ Sessions persistantes
- ✅ Photo de profil
