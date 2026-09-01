// Descriptor -> canonical merchant.
//
// Bank descriptors are hostile: processor prefixes (SQ *, PAYPAL *), embedded
// auth dates, store numbers, city/state tails, and per-charge transaction ids.
// Two charges from the same vendor must collapse to one key or nothing
// downstream works, so this runs before any recurrence detection.

// Curated catalog. Its real job is CATEGORY: "you pay for four streaming
// services" is only sayable if we know what a streaming service is. Unknown
// merchants still work — they just land in "Other".
const CATALOG = [
  [/\bNETFLIX\b/, 'Netflix', 'Streaming'],
  [/\bHULU\b/, 'Hulu', 'Streaming'],
  [/\bDISNEY\s*(PLUS|\+)?\b/, 'Disney+', 'Streaming'],
  [/\b(HBO\s*MAX|HBOMAX|\bMAX\.COM)\b/, 'Max', 'Streaming'],
  [/\bPARAMOUNT\s*(PLUS|\+)?\b/, 'Paramount+', 'Streaming'],
  [/\bPEACOCK\b/, 'Peacock', 'Streaming'],
  [/\bAPPLE\s*TV\b/, 'Apple TV+', 'Streaming'],
  [/\bYOUTUBE\s*(PREMIUM|TV)\b/, 'YouTube Premium', 'Streaming'],
  [/\bSPOTIFY\b/, 'Spotify', 'Music'],
  [/\bAPPLE\s*MUSIC\b/, 'Apple Music', 'Music'],
  [/\bSIRIUS\s*XM\b/, 'SiriusXM', 'Music'],
  [/\bAUDIBLE\b/, 'Audible', 'Music'],
  [/\bICLOUD\b/, 'iCloud', 'Storage'],
  [/\bDROPBOX\b/, 'Dropbox', 'Storage'],
  [/\bGOOGLE\s*(ONE|STORAGE)\b/, 'Google One', 'Storage'],
  [/\bADOBE\b/, 'Adobe', 'Software'],
  [/\bMICROSOFT\s*365|\bOFFICE\s*365\b/, 'Microsoft 365', 'Software'],
  [/\bNOTION\b/, 'Notion', 'Software'],
  [/\bFIGMA\b/, 'Figma', 'Software'],
  [/\bCANVA\b/, 'Canva', 'Software'],
  [/\bSLACK\b/, 'Slack', 'Software'],
  [/\bZOOM\b/, 'Zoom', 'Software'],
  [/\bGRAMMARLY\b/, 'Grammarly', 'Software'],
  [/\bGITHUB\b/, 'GitHub', 'Developer'],
  [/\bVERCEL\b/, 'Vercel', 'Developer'],
  [/\bDIGITALOCEAN\b/, 'DigitalOcean', 'Developer'],
  [/\bAWS\b|\bAMAZON\s*WEB\s*SERV/, 'AWS', 'Developer'],
  [/\bOPENAI\b|\bCHATGPT\b/, 'OpenAI', 'Developer'],
  [/\bANTHROPIC\b|\bCLAUDE\.AI\b/, 'Anthropic', 'Developer'],
  [/\b1PASSWORD\b/, '1Password', 'Security'],
  [/\bNORDVPN\b/, 'NordVPN', 'Security'],
  [/\bEXPRESSVPN\b/, 'ExpressVPN', 'Security'],
  [/\bLASTPASS\b/, 'LastPass', 'Security'],
  [/\bPLANET\s*FIT/, 'Planet Fitness', 'Fitness'],
  [/\bEQUINOX\b/, 'Equinox', 'Fitness'],
  [/\bPELOTON\b/, 'Peloton', 'Fitness'],
  [/\bCLASSPASS\b/, 'ClassPass', 'Fitness'],
  [/\bSTRAVA\b/, 'Strava', 'Fitness'],
  [/\bNY\s*TIMES|\bNYTIMES\b/, 'New York Times', 'News'],
  [/\bWALL\s*ST(REET)?\s*J|\bWSJ\b/, 'Wall Street Journal', 'News'],
  [/\bSUBSTACK\b/, 'Substack', 'News'],
  [/\bPATREON\b/, 'Patreon', 'News'],
  [/\bMEDIUM\b/, 'Medium', 'News'],
  [/\bDASHPASS\b|\bDOORDASH\b/, 'DoorDash', 'Food'],
  [/\bUBER\s*ONE\b/, 'Uber One', 'Food'],
  [/\bINSTACART\b/, 'Instacart+', 'Food'],
  [/\bHELLOFRESH\b/, 'HelloFresh', 'Food'],
  [/\bAMAZON\s*PRIME|\bPRIME\s*VIDEO\b/, 'Amazon Prime', 'Retail'],
  [/\bWALMART\s*\+|\bWALMART\s*PLUS\b/, 'Walmart+', 'Retail'],
  [/\bCOSTCO\b/, 'Costco', 'Retail'],
  [/\bCHEWY\b/, 'Chewy', 'Pets'],
  [/\bXBOX\b|\bGAME\s*PASS\b/, 'Xbox Game Pass', 'Gaming'],
  [/\bPLAYSTATION\b|\bPSN\b/, 'PlayStation Plus', 'Gaming'],
  [/\bNINTENDO\b/, 'Nintendo', 'Gaming'],
  [/\bSTEAM\b/, 'Steam', 'Gaming'],
  [/\bTWITCH\b/, 'Twitch', 'Gaming'],
  [/\bDUOLINGO\b/, 'Duolingo', 'Education'],
  [/\bMASTERCLASS\b/, 'MasterClass', 'Education'],
  [/\bCOURSERA\b/, 'Coursera', 'Education'],
  [/\bLINKEDIN\b/, 'LinkedIn Premium', 'Education'],
  [/\bVERIZON\b/, 'Verizon', 'Telecom'],
  [/\bT-?MOBILE\b/, 'T-Mobile', 'Telecom'],
  [/\bAT&T\b|\bATT\s*WIRELESS\b/, 'AT&T', 'Telecom'],
  [/\bCOMCAST\b|\bXFINITY\b/, 'Xfinity', 'Telecom'],
  [/\bSPECTRUM\b/, 'Spectrum', 'Telecom'],
  [/\bGEICO\b/, 'GEICO', 'Insurance'],
  [/\bSTATE\s*FARM\b/, 'State Farm', 'Insurance'],
  [/\bPROGRESSIVE\b/, 'Progressive', 'Insurance'],
  [/\bSQUARESPACE\b/, 'Squarespace', 'Web'],
  [/\bGODADDY\b/, 'GoDaddy', 'Web'],
  [/\bNAMECHEAP\b/, 'Namecheap', 'Web'],
  [/\bMAILCHIMP\b/, 'Mailchimp', 'Web'],
  [/\bQUICKBOOKS\b|\bINTUIT\b/, 'QuickBooks', 'Finance'],
];

// Processor prefixes and card-network noise, stripped from the front.
const PREFIXES = [
  /^(POS\s+)?(DEBIT|CREDIT)\s+CARD\s+(PURCHASE|PAYMENT)\s*/,
  /^PURCHASE\s+AUTHORIZED\s+ON\s+\d{1,2}\/\d{1,2}\s*/,
  /^(RECURRING\s+)?(PAYMENT|PMT)\s*(AUTHORIZED\s+ON\s+\d{1,2}\/\d{1,2})?\s*/,
  /^(ACH|EFT)\s+(DEBIT|PMT|PAYMENT|WITHDRAWAL)\s*/,
  /^(VISA|MASTERCARD|MC|AMEX)\s+(PURCHASE|DEBIT)\s*/,
  /^CHECKCARD\s+(\d{4}\s+)?/,
  /^POS\s+(DEBIT|PURCHASE)\s*/,
  /^(SQ|TST|SP|PP|PY)\s*\*\s*/,
  /^PAYPAL\s*(\*|\s)\s*(INST\s+XFER\s*)?/,
  /^(AUTOPAY|AUTO\s*PAY)\s*/,
  /^WEB\s+(PMT|PAYMENT)\s*/,
];

const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|' +
  'NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';

// Trailing junk: locations, phone numbers, ids, urls, card tails.
// Order matters — "SAN FRANCISCO CA" must be taken as a unit before anything
// gets a chance to nibble at "CA" on its own.
const SUFFIXES = [
  // Opaque ids. The digit lookahead is load-bearing: without it this rule reads
  // "FRANCISCO" as a transaction id and eats half the city.
  /\s+(WEB\s*ID:?\s*)?(?=[A-Z0-9]*\d)[A-Z0-9]{8,}$/,
  /\s+#\s*\d+$/,                            // store / order numbers
  /\s+\d{3}-\d{3}-\d{4}$/,                  // phone numbers
  /\s+\d{3}-\d{7}$/,
  /\s+(HELP|WWW|SUPPORT)\.[A-Z0-9.-]+$/,    // help.max.com
  /\s+[A-Z0-9-]+\.(COM|NET|ORG|IO|CO|TV|APP)$/,
  /\s+[A-Z\s]{3,20}\s+[A-Z]{2}$/,           // "SAN FRANCISCO CA"
  new RegExp(`\\s+(${US_STATES})$`),        // a bare state left behind
  /\s+(USA|GBR)$/,                          // never CA — that is California
  /\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,        // trailing date fragment
  /\s+X{2,}\d{4}$/,                          // masked card tail
];

/** Strip processor noise down to something a human would call the vendor. */
export function cleanDescriptor(description) {
  let s = String(description || '').toUpperCase();
  s = s.replace(/[^\w\s*&+.#/'-]/g, ' ').replace(/\s+/g, ' ').trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const re of PREFIXES) {
      const next = s.replace(re, '');
      if (next !== s) {
        s = next.trim();
        changed = true;
      }
    }
  }

  // Strip suffixes repeatedly, but never erase the whole descriptor.
  changed = true;
  while (changed) {
    changed = false;
    for (const re of SUFFIXES) {
      const next = s.replace(re, '').trim();
      if (next !== s && next.length >= 3) {
        s = next;
        changed = true;
      }
    }
  }

  s = s.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

function titleCase(s) {
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * @returns {{key: string, name: string, category: string, known: boolean}}
 */
export function normalizeMerchant(description) {
  const cleaned = cleanDescriptor(description);
  const haystack = `${cleaned} ${String(description || '').toUpperCase()}`;

  for (const [re, name, category] of CATALOG) {
    if (re.test(haystack)) {
      return { key: name.toUpperCase(), name, category, known: true };
    }
  }

  const fallback = cleaned || String(description || '').toUpperCase().trim();
  // Unknown vendors key on the first three words: enough to separate distinct
  // merchants, loose enough that a changing store number still collapses.
  const key = fallback.split(' ').slice(0, 3).join(' ');
  return { key: key || 'UNKNOWN', name: titleCase(key) || 'Unknown', category: 'Other', known: false };
}

export const CATEGORIES = [...new Set(CATALOG.map(([, , c]) => c)), 'Other'];
