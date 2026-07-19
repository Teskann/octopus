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
   elle se conclut. Et **ne démarre jamais un clip sur une réponse dont la
   question n'est pas dans le clip** (« Tout simplement parce que… », « Oui,
   parce que… », « Non, en fait… », toute réplique à un « Pourquoi / Comment /
   Est-ce que… ? » qui précède) : recule le `start_segment_id` pour **inclure la
   question**, ou choisis un autre départ. ⚠️ Le flag `starts_midsentence` ne
   détecte PAS ce cas (une réponse est souvent une phrase grammaticalement
   complète) — c'est à toi de vérifier le segment qui précède le début.
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
8. **Tout passe par le MCP — ne lis JAMAIS le projet en direct.** N'ouvre pas
   `data/projects/…`, `project.json`, les WAV/MP4, et ne parse pas les sorties
   avec `jq`/`awk`/`sed`/`ls`/`cat`. Utilise les outils MCP : pour les IDs de
   segments à une position, `get_transcript(format="rows", start=…, end=…)`
   **fenêtré** (petit) ou `search_transcript` / `get_segment` ; pour l'état du
   rendu, `render_status` (jamais un `ls` du dossier `exports/`). La **seule**
   écriture disque autorisée est la page HTML de l'étape 9. S'il te manque une
   capacité côté MCP, **dis-le à l'utilisateur** au lieu de contourner.
9. **Ouvre chaque clip sur une scène du présentateur si elle est disponible et
   valide** à cet instant (accroche humaine), puis bascule sur les slides dès que
   le propos renvoie à un visuel. Les changements de scène dynamiques (étape 7)
   sont **obligatoires** — pas une simple coupure d'intro.

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
- ⚠️ **Pour récupérer les `segment_id` à une position** (les paragraphes n'ont
  pas d'ID), appelle `get_transcript(format="rows", start=…, end=…)` **fenêtré
  autour du moment** : tu récupères les IDs directement par le MCP, sans jamais
  dumper toute la transcription ni lire un fichier. Le `rows` complet est
  volumineux — ne le charge pas d'un bloc.

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
- **Lis explicitement le PREMIER sous-titre de chaque clip** : s'il répond à une
  question qui n'est pas dans le clip (cf. règle d'or 2), recule le début pour
  **inclure la question**. `starts_midsentence=false` ne suffit PAS à le garantir.
- **Lis explicitement le DERNIER sous-titre : ne finis pas trop tard.** Le clip
  doit se terminer sur la **chute** de l'idée (punchline / conclusion), pas sur
  du remplissage ni une amorce du point suivant (« … on va le voir », « donc ça,
  on va voir l'utilisation », « bref, passons »). Si la fin traîne sur ce genre
  de queue, recule le `end_segment_id` jusqu'à la vraie chute.
- **Après CHAQUE clip, relis sa transcription et juge : trop court / trop long ?**
  Trop court = l'idée n'est pas comprise seule → élargis. Trop long (souvent
  > ~1 min 30) = il contient du gras ou deux temps → resserre, ou **découpe en
  deux clips atomiques** (règle d'or 1). C'est un vrai passage de décision, pas
  une formalité.
- Vérifie la **durée** (15 s – 2 min ; justifie tout dépassement).

### 7. Changements de scène dynamiques (présentateur ⇄ slides)
Objectif : montrer **les slides** quand le discours **renvoie à un visuel**
(texte, code, diapo, image, carte, schéma, graphique), et **le présentateur**
quand l'explication n'a pas besoin du visuel (intro, adresse directe à la salle,
transition, opinion, point à retenir).

**Règle d'ouverture (cf. règle d'or 9) : chaque clip DOIT commencer sur le
présentateur** si une scène présentateur est disponible et valide à cet instant
— pose une coupure « présentateur » sur le premier segment du clip, puis une
coupure « slides » sur le segment où le propos renvoie pour la première fois au
visuel (souvent « donc là, vous voyez… », « ce code… », « à l'écran… »). Vise
un plan présentateur d'ouverture d'au moins ~3–4 s. Les clips purement narratifs
(intro, opinion, punchline) restent **sur le présentateur d'un bout à l'autre**
(sauf si le slide derrière est utile).

**Rythme — ALTERNE EN CONTINU, sur TOUTE la durée (pas seulement au début).**
C'est le cœur d'un montage dynamique, et c'est à toi de le faire **d'initiative**,
sans qu'on te le demande. Règle simple : **aucun plan ne doit « traîner »** —
si un même plan (présentateur OU slides) dépasse ~**15–20 s**, coupe vers l'autre
scène (un contre-champ présentateur de ~6–10 s pendant qu'un code reste à
l'écran, ou une remontée sur la slide quand il pointe un détail). Bias par le
contenu : slides quand ça parle de code / tableau / figure, présentateur quand
ça parle sans support (intro, avis, réaction, transition), mais **même en zone
"slides" insère des contre-champs présentateur réguliers**. Un talk de 40 min =
des **dizaines** de coupures, pas deux. Si le seul visuel disponible est
hors-sujet (ex. diapo « References » pendant une conclusion), reste présentateur
plutôt que de montrer un visuel inutile. Génère le plan complet puis pose-le
d'un coup avec `set_scene_cuts` (les temps bruts sont acceptables **ici** pour un
rythme dense, c'est le seul cas — les clips, eux, restent ancrés aux segments).

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

### 9. Exporter + page HTML de publication
Une fois **tout validé**, produis le livrable final.

1. **Exporter tous les clips** : `export_clips(project_id)` (sans `clip_ids` =
   tous). L'export a besoin du **frontend Vite + Chrome** accessibles (comme
   l'export manuel). Sonde `render_status(project_id)` jusqu'à ce que **tous** les
   jobs soient `done` (signale les `error`). Chaque job `done` donne son
   `filename` (dans `data/projects/<id>/exports/`) et une URL `download`. Les
   écritures MCP étant persistées immédiatement, le `project.json` lu par le rendu
   est déjà à jour.

2. **Écrire une page HTML autonome** dans le dossier `exports/` du projet (à côté
   des MP4, pour les référencer en **relatif** `./<filename>.mp4` et ouvrir la
   page en `file://`). CSS/JS **inline**, aucune dépendance externe. Elle contient :
   - un **champ « Lien de la vidéo complète »** en haut de page ;
   - une **carte par clip**, triée par **score de viralité décroissant**, avec :
     - la vidéo intégrée `<video controls preload="metadata" src="./….mp4">` ;
     - le **titre** du clip ;
     - le **score de viralité** (badge + barre) + une justification en une ligne ;
     - la **description** proposée (zone copiable + bouton « Copier ») contenant un
       jeton `{{LIEN}}` ;
   - un **JS** qui, dès qu'on saisit le lien, remplace `{{LIEN}}` dans **toutes**
     les descriptions **en direct**, et fait que « Copier » copie le texte
     **complété** (avec le lien). Tant que le lien est vide, `{{LIEN}}` reste
     visible comme placeholder.
   - Design moderne, **police un peu grande** (confort de lecture), responsive,
     thèmes clair/sombre, **fonctionne hors-ligne** en `file://`.

3. **Répondre à l'utilisateur** avec le lien cliquable
   `file:///…/exports/<page>.html`, plus un court récap (clips, corrections,
   logique des scènes, points discutables).

**Score de viralité (0–100) — sois honnête : c'est ton estimation.** Pondère :
force de l'accroche (3 premières secondes) · autonomie (se comprend hors
contexte) · surprise / contre-intuitif / effet « waouh » · utilité concrète ·
clarté & rythme · portée (audience large vs niche pointue). Une phrase de
justification par clip.

**Descriptions — ton PRO, surtout PAS « généré par IA ».**
- Structure : **1 phrase d'accroche** + **1 question** + **1 invitation** à voir
  la vidéo complète (`… 👉 {{LIEN}}`).
- Écris comme un praticien qui partage sur LinkedIn/X : **concret, spécifique au
  contenu**, phrases courtes, vocabulaire du domaine.
- **Bannis** : superlatifs creux (« incroyable », « révolutionnaire », « vous
  n'allez pas croire »), hype, « Dans cette vidéo nous allons explorer… »,
  chapelets d'emojis (0–2 max, bien placés), formules génériques interchangeables,
  tirets cadratins en rafale.
- Reste dans la **langue de la vidéo**.
- Exemple de ton visé :
  > En C++, un accès hors limites peut faire retourner `true` à ta fonction… en
  > permanence. Le compilateur a-t-il vraiment le droit de faire ça ? L'explication
  > complète est dans la conf 👉 {{LIEN}}

## Pièges & bonnes pratiques (à ne pas rater)

- **Durée des caméras = contrainte physique.** Le cas classique : la caméra
  présentateur s'arrête avant la fin (ex. 21:29) → « slides only » ensuite. Se
  vérifie en 1 appel avec `list_scenes.duration`.
- **Diapo titre ≠ diapo contenu.** Un mot-clé de vue ne suffit pas : un screenshot
  tranche. Une diapo qui n'a qu'un titre → présentateur.
- **La scène « présentateur » peut être un simple recadrage (`crop`) de la vidéo
  composite** (le médaillon webcam agrandi), pas une caméra séparée. Deux pièges :
  (1) `get_frames(scene=…, apply_crop=false)` renvoie alors la **même** image que
  la principale — normal, c'est la même source ; regarde `apply_crop=true` pour
  voir le rendu réel du crop. (2) Ce crop **ne reste valide que tant que la mise
  en page composite tient** : si la capture bascule en plein cadre (ex. passage en
  Q&A filmé caméra à l'épaule) le crop médaillon tombe dans le vide (bandes
  noires / coin de décor). **Screenshot le crop en fin de talk** pour trouver
  l'instant de bascule et n'y coupe plus après.
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
| Export & page | `export_clips`, `render_status` (attendre `done`), puis écrire la page HTML dans `exports/` |
