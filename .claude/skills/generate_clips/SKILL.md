---
name: generate_clips
description: >
  Génère des clips courts, atomiques et prêts à publier (TikTok / Shorts /
  opus.pro) à partir d'un projet vidéo (typiquement une conférence/talk) dans
  l'éditeur transcript, via le MCP `transcript`. Couvre tout le workflow :
  analyser & renommer les scènes, corriger les sous-titres, repérer les moments
  forts (annonces, explications pédagogiques, punchlines), découper des clips
  calés sur les sous-titres, les titrer, et ajouter des changements de scène
  dynamiques (présentateur ⇄ slides). À utiliser quand l'utilisateur demande de
  « générer des clips », « trouver des clips », « faire des shorts » d'une vidéo.
---

# generate_clips — produire des clips à partir d'un talk

Tu transformes une vidéo déjà transcrite en une série de clips courts et
autonomes. Tout passe par les outils MCP `transcript`. Ce skill décrit le
workflow complet + les pièges qui coûtent cher si on les ignore.

## Règles d'or (non négociables)

1. **Un clip = une seule idée.** Atomique. Jamais deux explications ni deux
   parties de la présentation dans le même clip. Si une explication dure
   naturellement > 2 min et contient deux temps (mise en place puis révélation),
   **découpe-la en deux clips atomiques** autonomes.
2. **Ne coupe pas une explication** et **ne la commence pas en retard** : le clip
   commence au **premier** segment de l'idée et finit au **dernier** segment où
   elle se conclut.
3. **Durée 15 s – 2 min** (tolérance pour dépasser si c'est justifié et que couper
   trahirait l'explication).
4. **Ancre tout aux sous-titres**, jamais aux timecodes bruts. Les bornes de
   segment sont déjà des frontières de mots → coupes propres par construction.
   Utilise les outils `*_from_segments` / `*_at_segment` / `segment_id`. N'emploie
   un temps brut (secondes) **que** si l'utilisateur t'en donne un explicitement.
5. **Respecte la durée de chaque scène** (voir étape 1) : ne bascule **jamais**
   sur une caméra à un instant au-delà de sa propre durée.
6. **Écris en lot / de façon atomique** (`batch_edit_segments`, `set_scene_cuts`,
   `create_clip_from_segments`) : moins d'appels, et l'état est facile à
   reposer si le projet est co-édité entre deux tours.
7. **Langue de la vidéo** pour tout ce qui est visible (titres de clips,
   corrections de sous-titres). Ici : français.

## Workflow

### 0. Résoudre le projet
- `find_projects("<nom>")` → récupère l'`id`. Les noms ne sont pas uniques :
  vérifie que tu prends le bon (statut `ready`, bonne durée).
- `list_clips` / `list_scene_cuts` pour voir ce qui existe déjà (souvent des
  essais résiduels à supprimer).

### 1. Analyser & renommer les scènes
- `list_scenes` → note pour **chaque** scène sa **`duration`** et `has_audio`.
  `scenes[0]` (« main ») porte l'audio ; c'est en général la **capture d'écran**
  (slides). Les autres sont des angles muets synchronisés.
- **Regarde chaque scène** : `get_frames(project_id, times=[…], scene="<id>")`
  avec 3–5 instants répartis sur la durée. Identifie ce qu'elle montre.
  - Par défaut le screenshot applique la **fenêtre de recadrage** de la scène
    (main = fenêtre `frame` du projet, secondaire = son `crop`) → tu vois **ce qui
    apparaît réellement** dans le clip. Passe `apply_crop=false` pour l'image
    brute (utile seulement pour choisir un nouveau cadrage).
  - La scène « slides » montre souvent **la diapo + le présentateur en médaillon +
    un numéro de slide** dans un coin — pratique pour repérer les diapos.
- `rename_scene(project_id, scene_id, "Slides" | "Présentateur" | …)` selon ce
  qu'elles représentent réellement.
- ⚠️ **Limite dure** : si une caméra secondaire est **plus courte que le talk**
  (fréquent : elle s'arrête en cours de route), tu ne pourras la montrer que
  jusqu'à sa `duration`. Au-delà → **forcer « main »**. Repère ça maintenant,
  pas à l'export.

### 2. Lire la retranscription
- `get_transcript(project_id, format="paragraphs")` → toute la conf en **une**
  lecture bon marché (~10× plus petit que le JSON timé, avec ancres `start/end`).
  C'est la vue pour **comprendre l'arc** et repérer les moments.
- Besoin des bornes de mots exactes d'un segment : `get_segment(project_id, id)`
  ou `format="rows"`. `format="text"` = prose pure si tu veux juste lire.

### 3. Corriger les sous-titres
Repère et corrige :
- **fautes d'accord** (genre/nombre, participes, conjugaison) ;
- **erreurs de vocabulaire / jargon mal transcrit** (ex. « sharp pointer » →
  *shared pointer*, « statique à serf » → *static_assert*, noms propres) ;
- **auto-corrections orales** : si l'orateur se reprend, ne garde que la version
  **compréhensible/corrigée**, pas la phrase abandonnée ;
- ponctuation qui casse le sens.

Méthode :
- `search_transcript(project_id, "<terme suspect>")` pour trouver **toutes** les
  occurrences d'un même terme mal transcrit d'un coup.
- Applique **toutes** les corrections en **un seul** `batch_edit_segments(
  project_id, edits=[{segment_id, text}, …])`. Les timings mot-à-mot sont
  recalculés automatiquement quand `text` change. Ne fais pas 40 appels unitaires.
- Garde les corrections **chirurgicales** : ne réécris pas un style correct.

### 4. Repérer les moments & en déduire les segments
Cherche, dans la prose de l'étape 2 :
- **annonces / accroches** : chiffres chocs, punchlines, promesses (« X % des
  bugs viennent de… »), retournements ;
- **explications pédagogiques** claires et autoportantes ;
- **démonstrations / exemples** (code, cas pratique, avant/après) ;
- **échanges Q&A** seulement s'ils sont **autonomes**.

Écarte : les transitions/meublage, les « où en étais-je », et la **conclusion**
type « je vous laisse avec un résumé » (pas un clip).

Pour chaque moment retenu, identifie :
- le **segment de début** = tout premier segment de l'idée (souvent la phrase
  d'accroche / la question posée) ;
- le **segment de fin** = dernier segment où l'idée se boucle (la punchline / la
  conclusion du point).

### 5. Créer les clips + titres
- `create_clip_from_segments(project_id, start_segment_id, end_segment_id,
  name="<titre>")`. (Omets `end_segment_id` pour un clip d'un seul sous-titre.)
- **Titre** : court, accrocheur, dans la langue de la vidéo, capture le
  bénéfice/la punchline (ex. « Quand le compilateur transforme ta fonction en
  `return true` »).
- Pour poser tout le plan d'un coup, tu peux aussi utiliser `set_clips` (mais
  privilégie les bornes issues des segments).

### 6. Vérifier les clips (QA)
- `get_clip_transcript(project_id)` (sans `clip_id` → **tous** les clips) : lis le
  texte de chaque clip et regarde les flags **`starts_midsentence` /
  `ends_midsentence`**.
- Si un clip commence/finit en milieu de phrase → recale-le :
  `retime_clip_to_segments(project_id, clip_id, start_segment_id, end_segment_id)`.
- Vérifie la **durée** (15 s – 2 min ; justifie tout dépassement).

### 7. Changements de scène dynamiques (présentateur ⇄ slides)
Objectif : montrer **les slides** quand le discours **renvoie à un visuel**
(texte, code, diapo, image, carte, schéma, graphique), et **le présentateur**
quand l'explication n'a pas besoin du visuel (intro, adresse directe à la salle,
transition, opinion, point à retenir).

1. **Repère les moments « visuels »** via des mots-clés de vue :
   `search_transcript` sur « regardez », « vous voyez », « on voit », « voir »,
   « à l'écran », « ici », « cette ligne / fonction / slide / image / carte »,
   « ce code / schéma / graphique », « comme vous pouvez le voir », « jeter un
   œil », « affiché », « en haut / en bas / à droite / à gauche ». Récupère les
   `segment_id`.
2. **Confirme par screenshot** : `get_frame(project_id, t, scene="<slides>")` à
   l'instant. Si la diapo montre vraiment un contenu (code/figure) → **Slides**.
   Si c'est une diapo **titre/section nue** (juste un titre) → **Présentateur**,
   même si un mot-clé a matché. Inversement, dès que l'explication n'a plus besoin
   du visuel (vérifie au screenshot) → repasse **Présentateur**.
3. **Cale sur les vraies transitions de diapo** si besoin :
   `list_scene_changes(project_id, scene="<slides>", threshold=0.12,
   crop="<W>:<H>:0:0")` — le `crop` **exclut le médaillon webcam** pour éviter les
   faux positifs dus au présentateur qui bouge.
4. **Pose toutes les coupures d'un coup**, ancrées aux segments :
   `set_scene_cuts(project_id, cuts=[{scene_id, segment_id, at?}, …])`.
   - Scène par défaut (sans coupure) = « main ». Pour **démarrer** sur le
     présentateur, ajoute une coupure au tout début.
   - `at="end"` pour revenir juste **après** la fin d'un segment.
   - ⚠️ **N'ajoute aucune coupure vers une caméra au-delà de sa `duration`**
     (étape 1). Si la caméra présentateur s'arrête à T, tout ce qui suit T reste
     sur « main ».
   - Évite les blips hachés (< ~5–8 s) sauf beat fort.

### 8. Vérification finale
- `list_scene_cuts` + `list_clips` pour confirmer l'état posé.
- Optionnel : `get_frame(project_id, t, mode="preview")` pour **voir** le rendu
  composé (sous-titres + reframe + scène active) d'un instant clé avant export.
- Fais un court récap à l'utilisateur : nb de clips, corrections, logique des
  scènes, points d'interprétation discutables.

## Pièges & bonnes pratiques (à ne pas rater)

- **Durée des caméras = contrainte physique.** Le cas classique : la caméra
  présentateur s'arrête avant la fin (ex. 21:29) → « slides only » ensuite. Se
  vérifie en 1 appel avec `list_scenes.duration`.
- **Diapo titre ≠ diapo contenu.** Un mot-clé de vue ne suffit pas : un screenshot
  tranche. Une diapo qui n'a qu'un titre → présentateur.
- **Split des explications trop longues.** Une démo de 2 min 20 avec « la fonction
  piège » puis « pourquoi le compilo la casse » = **deux** clips atomiques.
- **Auto-corrections orales** → ne transcris que la version corrigée.
- **Écritures atomiques = filet de sécurité.** Le front sauvegarde en debounce et
  le rendu lit le `project.json` sauvegardé ; le projet peut être co-édité entre
  deux tours. Poser un plan complet via `set_scene_cuts` / `set_clips` /
  `batch_edit_segments` permet de tout reposer en 2-3 appels si l'état est perdu.
- **Segment-ancré par défaut.** Les outils à time brut (`create_clip`,
  `add_scene_cut`, `update_clip` re-timing) sont marqués ⚠️ ; ne les utilise que
  sur demande explicite d'un timecode.
- **La coupe par défaut est « main »** : inutile de poser une coupure « main » là
  où c'est déjà l'état (elles sont dédupliquées côté rendu de toute façon).

## Antisèche outils

| Étape | Outils |
|---|---|
| Projet | `find_projects`, `list_clips`, `list_scene_cuts` |
| Scènes | `list_scenes` (durée/audio), `get_frame(scene=…)`, `get_frames`, `rename_scene` |
| Lire | `get_transcript(format="paragraphs"/"text"/"rows")`, `get_segment`, `search_transcript` |
| Corriger | `batch_edit_segments`, `search_transcript` |
| Clips | `create_clip_from_segments`, `set_clips`, `retime_clip_to_segments`, `get_clip_transcript` |
| Scènes dyn. | `list_scene_changes(crop=…)`, `add_scene_cut_at_segment`, `set_scene_cuts(segment_id)` |
| Rendu/QA | `get_frame(mode="preview")`, `list_clips`, `list_scene_cuts` |
