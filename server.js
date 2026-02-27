const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3457;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = 'gemini-2.5-flash';

let genAI = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

// =====================
// GEMINI HELPER
// =====================

async function callGemini(systemPrompt, userMessage, maxTokens = 4096, schema = null) {
  if (!genAI) throw new Error('GEMINI_API_KEY manquante');
  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: 0.3,
    responseMimeType: 'application/json',
    ...(schema ? { responseSchema: schema } : {})
  };
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    generationConfig
  });
  const result = await model.generateContent(userMessage);
  const rawText = result.response.text().trim();
  console.log(`[Gemini preview]: ${rawText.substring(0, 150).replace(/\n/g, '\\n')}`);
  return robustJsonParse(rawText);
}

function robustJsonParse(raw) {
  if (raw.startsWith('{') || raw.startsWith('[')) return JSON.parse(raw);
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return JSON.parse(fence[1].trim());
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) return JSON.parse(brace[0]);
  throw new SyntaxError(`No valid JSON found: ${raw.substring(0, 100)}`);
}

// =====================
// DONNÉES MARCHÉ FR
// (source : Malt, Comet, Crème de la Crème 2024)
// =====================

const MARKET_DATA_FR = `
Données de référence marché freelance France (TJM = Taux Journalier Moyen, base 8h) :

TECH & DEV :
- Développeur web junior (<2 ans) : 280-380€/j | 35-47€/h
- Développeur web mid (2-5 ans) : 380-550€/j | 47-69€/h
- Développeur web senior (5+ ans) : 550-750€/j | 69-94€/h
- Développeur fullstack senior : 600-850€/j | 75-106€/h
- Lead dev / architecte : 700-1000€/j | 87-125€/h
- Dev mobile (iOS/Android) : 500-800€/j | 62-100€/h
- Dev data / ML engineer : 600-900€/j | 75-112€/h
- DevOps / Cloud : 600-850€/j | 75-106€/h

DESIGN :
- Designer UI/UX junior : 300-450€/j | 37-56€/h
- Designer UI/UX mid : 450-650€/j | 56-81€/h
- Designer UI/UX senior : 650-900€/j | 81-112€/h
- Directeur artistique : 600-900€/j | 75-112€/h
- Motion designer : 400-700€/j | 50-87€/h

MARKETING & CONTENU :
- Rédacteur / Copywriter junior : 200-350€/j | 25-44€/h
- Rédacteur / Copywriter senior : 350-600€/j | 44-75€/h
- SEO specialist : 350-600€/j | 44-75€/h
- Social media manager : 300-500€/j | 37-62€/h
- Growth hacker : 450-750€/j | 56-94€/h
- Consultant marketing digital : 500-800€/j | 62-100€/h

CONSULTING & MANAGEMENT :
- Chef de projet digital : 450-700€/j | 56-87€/h
- Product Manager : 600-900€/j | 75-112€/h
- Consultant RH : 500-900€/j | 62-112€/h
- Consultant financier / CFO : 700-1200€/j | 87-150€/h
- Consultant stratégie : 800-1500€/j | 100-187€/h
- Formateur : 800-2000€/j | 100-250€/h

FACTEURS DE CORRECTION PAR VILLE :
- Paris : +10 à +20% vs moyenne FR
- Lyon, Bordeaux, Nantes : référence (0%)
- Villes moyennes / remote : -5 à -10%
- Full remote (client Paris) : taux Paris applicable

FACTEURS QUALITÉ :
- Portfolio faible : -15 à -20%
- Portfolio solide : référence
- Portfolio fort : +10 à +15%
- Portfolio primé / références top : +20 à +30%

FACTEURS TYPE CLIENT :
- Startup early-stage : -10 à -15% (compenser par equity/visibilité)
- PME : référence
- ETI / Grand groupe : +10 à +20%
- Agence (vous êtes sous-traitant) : -5 à -10%

FACTEURS DURÉE / ENGAGEMENT :
- Mission <1 semaine : +10 à +15% (urgence)
- Mission 1-4 semaines : référence
- Retainer 3+ mois : -5 à -10% (stabilité = légère remise)
- Retainer 6+ mois : -10 à -15%
`;

// =====================
// SYSTEM PROMPTS
// =====================

const SYSTEM_PROMPT_CALCULATE = `Tu es un conseiller expert en pricing pour freelances français. 
Tu aides les indépendants à fixer leur taux de façon objective, basée sur les données marché réelles.
Tu réponds UNIQUEMENT en JSON valide avec la structure demandée.
Sois précis avec les chiffres, utilise TOUJOURS l'euro (€) et les jours/heures FR.
${MARKET_DATA_FR}`;

const SYSTEM_PROMPT_NEGOTIATE = `Tu es un coach en négociation commerciale pour freelances français.
Tu génères des scripts de négociation concrets, directement utilisables en email ou en call.
Tu réponds UNIQUEMENT en JSON valide avec la structure demandée.
Adapte le ton au type de client (startup = direct, grand groupe = formel).`;

// =====================
// POST /api/calculate
// =====================

const calculateSchema = {
  type: 'object',
  properties: {
    tauxHoraire: {
      type: 'object',
      properties: {
        bas: { type: 'number' },
        cible: { type: 'number' },
        premium: { type: 'number' }
      },
      required: ['bas', 'cible', 'premium']
    },
    tjm: {
      type: 'object',
      properties: {
        bas: { type: 'number' },
        cible: { type: 'number' },
        premium: { type: 'number' }
      },
      required: ['bas', 'cible', 'premium']
    },
    positionMarche: { type: 'string' },
    resumePositionnement: { type: 'string' },
    justificationCible: { type: 'string' },
    quandUtiliserBas: { type: 'string' },
    quandUtiliserPremium: { type: 'string' },
    alertes: { type: 'array', items: { type: 'string' } },
    conseils: { type: 'array', items: { type: 'string' } },
  },
  required: ['tauxHoraire', 'tjm', 'positionMarche', 'resumePositionnement', 'justificationCible', 'quandUtiliserBas', 'quandUtiliserPremium', 'alertes', 'conseils']
};

app.post('/api/calculate', async (req, res) => {
  const {
    competence, experience, localisation, arrangement,
    specialisation, typeProjet, complexite, typeClient,
    duree, descriptionProjet, qualitePortfolio, niveauDemande, valeurUnique
  } = req.body;

  if (!competence || !experience) {
    return res.status(400).json({ error: 'Compétence et expérience requis.' });
  }
  if (!genAI) {
    return res.status(500).json({ error: 'Clé API manquante. Configurez GEMINI_API_KEY.' });
  }

  const userMessage = `
PROFIL FREELANCE :
- Compétence principale : ${competence}
- Expérience : ${experience}
- Localisation : ${localisation || 'France (non précisé)'}
- Mode de travail : ${arrangement || 'Non précisé'}
- Spécialisation : ${specialisation || 'Généraliste'}

DÉTAILS DE LA MISSION :
- Type : ${typeProjet || 'Non précisé'}
- Complexité : ${complexite || 'Standard'}
- Type de client : ${typeClient || 'PME'}
- Durée estimée : ${duree || 'Non précisé'}
- Description : ${descriptionProjet || 'Non précisé'}

POSITIONNEMENT :
- Qualité du portfolio : ${qualitePortfolio || 'Solide'}
- Niveau de demande actuel : ${niveauDemande || 'Quelques leads'}
- Valeur unique : ${valeurUnique || 'Non précisé'}

Calcule les taux recommandés en €/h et TJM (€/jour base 8h) pour ce profil.
`;

  try {
    const result = await callGemini(SYSTEM_PROMPT_CALCULATE, userMessage, 8192, calculateSchema);

    // Calcul déterministe de la projection (15 jours facturés/mois)
    const JOURS_FACTURES = 15;
    const tjmBas = result.tjm?.bas || 0;
    const tjmCible = result.tjm?.cible || 0;
    const tjmPremium = result.tjm?.premium || 0;
    result.projectionMensuelle = `Sur ${JOURS_FACTURES} jours facturés/mois : ${(tjmBas * JOURS_FACTURES).toLocaleString('fr-FR')}€ (compétitif) · ${(tjmCible * JOURS_FACTURES).toLocaleString('fr-FR')}€ (cible) · ${(tjmPremium * JOURS_FACTURES).toLocaleString('fr-FR')}€ (premium)`;

    res.json(result);
  } catch (err) {
    console.error('Erreur calcul:', err.message);
    if (err.name === 'SyntaxError') {
      return res.status(500).json({ error: 'Erreur de parsing. Veuillez réessayer.' });
    }
    res.status(500).json({ error: `Erreur: ${err.message}` });
  }
});

// =====================
// POST /api/negotiate  (feature premium)
// =====================

const negotiateSchema = {
  type: 'object',
  properties: {
    scriptEmail: { type: 'string' },
    scriptCall: { type: 'string' },
    reponseTropCher: { type: 'string' },
    reponseRemise: { type: 'string' },
    pointsForts: { type: 'array', items: { type: 'string' } },
    erreursCourantes: { type: 'array', items: { type: 'string' } }
  },
  required: ['scriptEmail', 'scriptCall', 'reponseTropCher', 'reponseRemise', 'pointsForts', 'erreursCourantes']
};

app.post('/api/negotiate', async (req, res) => {
  const { competence, typeClient, tauxCible, duree, descriptionProjet } = req.body;

  if (!tauxCible) {
    return res.status(400).json({ error: 'Taux cible requis.' });
  }
  if (!genAI) {
    return res.status(500).json({ error: 'Clé API manquante.' });
  }

  const userMessage = `
Génère des scripts de négociation pour :
- Freelance spécialisé en : ${competence || 'développement web'}
- Taux cible à défendre : ${tauxCible}€/h
- Type de client : ${typeClient || 'PME'}
- Durée mission : ${duree || 'non précisé'}
- Contexte mission : ${descriptionProjet || 'non précisé'}

Génère :
1. Un email de proposition tarifaire professionnel
2. Un pitch de 3-4 phrases pour un appel téléphonique
3. Une réponse à "c'est trop cher" qui tient la position
4. Une réponse à "vous pouvez faire une remise ?" qui propose un compromis intelligent
5. 3-4 points forts à mentionner pour justifier le taux
6. Les 3 erreurs de négociation les plus fréquentes à éviter
`;

  try {
    const result = await callGemini(SYSTEM_PROMPT_NEGOTIATE, userMessage, 8192, negotiateSchema);
    res.json(result);
  } catch (err) {
    console.error('Erreur négociation:', err.message);
    res.status(500).json({ error: `Erreur: ${err.message}` });
  }
});

// =====================
// START
// =====================

app.listen(PORT, () => {
  console.log(`TauxJuste running on port ${PORT}`);
  if (!GEMINI_API_KEY) console.warn('⚠️  GEMINI_API_KEY not set');
});
