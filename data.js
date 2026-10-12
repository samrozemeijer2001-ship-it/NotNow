/* =========================================================
   HET SCHEMA — pas hier oefeningen, sets en reps aan.

   Sets-blok:  [naam, [reps per set], "notitie", "YouTube-zoekterm", [spiergroepen]]
   Lijst-blok: [naam, "dosering", "YouTube-zoekterm", [spiergroepen], loggen?]
               loggen = true geeft een kg-vakje (bijv. Arm Farm)

   De eerste spiergroep is de hoofdgroep (telt mee voor sets per spiergroep).
   Een oefening met dezelfde naam op een andere dag deelt dezelfde geschiedenis.
   ========================================================= */

const SCHEMA_WEEK = "week van 12 okt 2026";

const GROUPS = {
  benen:     "Benen",
  achter:    "Hamstrings & billen",
  borst:     "Borst",
  rug:       "Rug",
  schouders: "Schouders",
  armen:     "Armen",
  kuiten:    "Kuiten & enkels",
  core:      "Core & rotatie",
  power:     "Explosief"
};

const ARM_FARM = {
  type: "list", letter: "+", name: "Arm Farm", sub: "3 sets biceps / triceps",
  intro: "Kies 1 biceps- en 1 triceps-oefening, 3 sets. Vul je zwaarste set in. Bij dips: extra gewicht (0 = lichaamsgewicht).",
  items: [
    ["DB / BB Bicep Curl", "", "bicep curl dumbbell barbell technique", ["armen"], true],
    ["Hammer Curl", "", "hammer curl technique", ["armen"], true],
    ["Preacher Curl", "", "preacher curl technique", ["armen"], true],
    ["Bar / Rope Tricep Pushdown", "", "rope tricep pushdown technique", ["armen"], true],
    ["Skull Crushers", "", "skull crusher exercise technique", ["armen"], true],
    ["Dips", "", "tricep dips technique", ["armen", "borst"], true]
  ]
};

const WEEK = [
  {
    key: "ma", short: "Ma", long: "Maandag", title: "Lower Body", tag: "Lower",
    blocks: [
      { type: "list", letter: "W", name: "Lower Body Prehab C", sub: "Warming-up", items: [
        ["Hip / Hamstring mobility & foamroll", "5 min", "hip hamstring mobility foam roll routine"],
        ["Split Squat ISO hold", "2 × 30 sec", "split squat isometric hold"],
        ["Kang Squat", "2 × 8", "kang squat exercise"],
        ["Cossack Squat", "2 × 6 per kant", "cossack squat technique"]
      ]},
      { type: "sets", letter: "P", name: "Explosief", sub: "Power · 2 sets", ex: [
        ["Seated CMJ", [5, 5], "", "seated countermovement jump box jump", ["power", "benen"]],
        ["Banded Knee Switch", [5, 5], "Focus op techniek, snelle switch, tenen omhoog", "banded knee switch drill", ["power"]]
      ]},
      { type: "sets", letter: "A", name: "Hoofdoefening", sub: "Kracht · 3 sets", ex: [
        ["Squat Variation", [6, 5, 5], "Back / Front / Trapbar", "back squat technique", ["benen", "achter"]]
      ]},
      { type: "sets", letter: "B", name: "Superset B", sub: "Wissel af · 3 rondes", ex: [
        ["RDL (Romanian Deadlift)", [6, 6, 6], "", "romanian deadlift technique", ["achter", "rug"]],
        ["Cossack Squat", [6, 6, 6], "", "cossack squat technique", ["benen"]]
      ]},
      { type: "sets", letter: "C", name: "Superset C", sub: "Wissel af · 3 rondes", ex: [
        ["Copenhagen Plank", ["20s", "20s", "20s"], "", "copenhagen plank technique", ["core"]],
        ["Single Leg Calf Raises", [10, 10, 10], "", "single leg calf raise technique", ["kuiten"]]
      ]},
      { type: "list", letter: "+", name: "Lower Top Ups", sub: "Afsluiter", items: [
        ["Clamshells", "2 × 12", "clamshell exercise band"],
        ["Tibia raises", "2 × 12", "tibialis raise exercise"]
      ]}
    ]
  },
  {
    key: "di", short: "Di", long: "Dinsdag", title: "Upper Body", tag: "Upper",
    blocks: [
      { type: "list", letter: "W", name: "Upper Body Prehab C", sub: "Warming-up", items: [
        ["Banded pull aparts", "2 × 15", "band pull apart technique"],
        ["Upside down kettlebell press", "2 × 8 per kant", "bottoms up kettlebell press"],
        ["Press up rotations", "2 × 5 per kant", "push up with rotation T push up"],
        ["Ab rollouts", "2 × 10", "ab wheel rollout technique"]
      ]},
      { type: "sets", letter: "P", name: "Explosief", sub: "Power · 2 sets", ex: [
        ["MB Rotation Slam", [4, 4], "", "medicine ball rotational slam", ["power", "core"]],
        ["Plyo Push Up", [5, 5], "", "plyometric push up technique", ["power", "borst"]]
      ]},
      { type: "sets", letter: "A", name: "Hoofdoefening", sub: "Kracht · 3 sets", ex: [
        ["Barbell Bench Press", [6, 6, 5], "", "barbell bench press technique", ["borst", "schouders", "armen"]]
      ]},
      { type: "sets", letter: "B", name: "Superset B", sub: "Wissel af · 3 rondes", ex: [
        ["Z-Press", [6, 6, 6], "", "z press technique", ["schouders", "core"]],
        ["Chest Supported Row", [8, 8, 8], "", "chest supported row technique", ["rug", "armen"]]
      ]},
      { type: "sets", letter: "C", name: "Superset C", sub: "Wissel af · 3 rondes", ex: [
        ["NG Pull-up", [8, 8, 6], "Vul extra gewicht in (0 = lichaamsgewicht)", "neutral grip pull up technique", ["rug", "armen"]],
        ["Banded Chops", [8, 8, 8], "Zware band: explosief roteren, langzaam terug", "banded wood chop exercise", ["core"]]
      ]},
      ARM_FARM
    ]
  },
  {
    key: "wo", short: "Wo", long: "Woensdag", title: "Rust", tag: "Rust", rest: true,
    text: "Rustdag. Herstel is ook training.",
    tips: ["Licht wandelen of fietsen", "Foamrollen en mobility", "Goed eten en slapen"]
  },
  {
    key: "do", short: "Do", long: "Donderdag", title: "Full Body", tag: "Full",
    blocks: [
      { type: "list", letter: "W", name: "Full Body Prehab B", sub: "Warming-up", items: [
        ["Hip / Hamstring mobility & foam roll", "5 min", "hip hamstring mobility foam roll routine"],
        ["Single Leg Calf ISO Hold", "2 × 30 sec per kant", "single leg calf isometric hold"],
        ["Tibia raise", "2 × 10", "tibialis raise exercise"],
        ["Spanish Squat", "2 × 10", "spanish squat exercise"],
        ["Cuban Press", "2 × 10", "cuban press technique"]
      ]},
      { type: "sets", letter: "P", name: "Explosief", sub: "Power · 2 sets", ex: [
        ["Broad Jump", [3, 3], "", "broad jump technique", ["power", "benen"]],
        ["Skater Jumps", [5, 5], "", "skater jumps exercise", ["power", "benen"]]
      ]},
      { type: "sets", letter: "A", name: "Hoofdoefening", sub: "Kracht · 3 sets", ex: [
        ["Quarter Split Squat", [5, 5, 5], "", "quarter split squat", ["benen"]]
      ]},
      { type: "sets", letter: "B", name: "Superset B", sub: "Wissel af · 3 rondes", ex: [
        ["Landmine Throw", [6, 6, 6], "", "landmine rotational throw", ["power", "core", "schouders"]],
        ["Landmine Sunrises", [6, 6, 6], "", "landmine sunrise exercise", ["core", "schouders"]]
      ]},
      { type: "sets", letter: "C", name: "Superset C", sub: "Wissel af · 3 rondes", ex: [
        ["Hamstring Iso Hold", ["15s", "15s", "15s"], "", "hamstring isometric hold", ["achter"]],
        ["Single Leg Glute Bridge", [8, 8, 8], "", "single leg glute bridge technique", ["achter"]]
      ]},
      ARM_FARM
    ]
  },
  {
    key: "vr", short: "Vr", long: "Vrijdag", title: "Primer", tag: "Primer", rest: true, active: true,
    text: "Primer session. Interesse? Stuur je trainer een berichtje.",
    tips: ["Kort en explosief, geen zware volumes", "Fris blijven voor zaterdag"]
  },
  {
    key: "za", short: "Za", long: "Zaterdag", title: "Gameday", tag: "Game", rest: true, active: true,
    text: "Wedstrijddag. Geen wedstrijd? Doe een korte top-up of pump sessie.",
    tips: ["Top-up: prehab van deze week", "Pump: Arm Farm, 3 sets biceps / triceps"]
  },
  {
    key: "zo", short: "Zo", long: "Zondag", title: "Rust", tag: "Rust", rest: true,
    text: "Rustdag. Herstellen van de wedstrijd.",
    tips: ["Wandelen, zwemmen of fietsen", "Stretchen en foamrollen"]
  }
];
