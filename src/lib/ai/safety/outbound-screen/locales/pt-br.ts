/** Outbound-screen banks for Brazilian Portuguese, composed by `../../outbound-screen.ts`. */
import {
  DRUG_UNIT,
  DOSE_UNIT,
  UNIT_END,
  objectSlot,
  TARGET,
  LETTER,
  ENGINE,
  medicationExtras,
  type LocaleBank,
} from "../shared";

const PT_STOP =
  "não|nao|nunca|jamais|e|ou|mas|se|sódio|sal|cafeína|açúcar\\S*|água|proteínas?|fibras?|café|álcool|passos|calorias";

const PT_SLOT = objectSlot(PT_STOP);

const PT_SHORT = objectSlot(
  `${PT_STOP}|para|pra|com|antes|depois|sem|a|ao|à|de|do|da|em|no|na|por|durante|sobre`,
  2,
);

const PT_MED_NOUN =
  "(?:doses?|comprimidos?|pastilhas?|dr[áa]geas?|c[áa]psulas?|medicamentos?|rem[ée]dios?|medica[çc](?:[ãa]o|[õo]es)|insulina|inje[çc](?:[ãa]o|[õo]es)|tratamento)";

const SPELLED_PT =
  "(?:zero|um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta)";

const PCT_WORD_PT = `${SPELLED_PT}\\s+por\\s+cento`;

const QUAL_NUM_PT = `(?:\\d{1,3}\\s*%|${PCT_WORD_PT})`;

const RISK_NOUN_PT = "(?:risco|probabilidade|chance)";

const HORIZON_PT =
  "(?:risco\\s+(?:cardiovascular|card[íi]aco|de\\s+(?:avc|infarto|morte|mortalidade))\\s+(?:em|para|nos\\s+pr[óo]ximos)\\s+(?:10|dez)\\s+anos)";

const RESULT_VERB_PT =
  "(?:(?:te|lhe|o|a)\\s+(?:coloca|classifica|situa|enquadra|p[õo]e)|coloca\\s+voc[êe]|voc[êe]\\s+(?:est[áa]|fica|cai|se\\s+enquadra)\\s+(?:n[oa]s?|em))";

const RISK_BAND_PT =
  "(?:(?:faixa|categoria|grupo)\\s+de\\s+)?(?:alto|baixo|m[ée]dio|moderado|elevado|intermedi[áa]rio)\\s+risco";

const RISK_LEVEL_PT =
  "(?:elevad[oa]|alt[oa]|moderad[oa]|intermedi[áa]ri[oa]|lim[íi]trofe|preocupante|significativ[oa])";

const RISK_VERDICT_PT = `(?:é|est[áa]|parece|fica|continua|indica|mostra|aponta\\s+para)\\s+(?:\\S+\\s+){0,2}${RISK_LEVEL_PT}`;

const PT_MED_CLASS =
  "(?:anticoagulantes?|antiagregantes?|estatinas?|beta-?bloqueadores?|diur[ée]ticos?|antidepressivos?|anti-?hipertensivos?|sonífer[oa]s?|rem[ée]dios?\\s+(?:para\\s+(?:a\\s+)?|de\\s+)(?:press[ãa]o|dormir|afinar\\s+o\\s+sangue))";

export const bank: LocaleBank = {
  vocabulary: (names) =>
    `(?:${PT_MED_NOUN}|${medicationExtras(PT_MED_CLASS, names)})`,
  doseChangeClass: (med) => [
    // Brazilian Portuguese addresses the reader as "você", whose imperative
    // is the subjunctive form ("aumente", "tome", "pule"). The indicative a
    // log restatement uses ("você toma 1000 mg", "a dose passou para 2000
    // mg") is not in any verb list.
    new RegExp(
      `(?<!\\b(?:não|nao|nunca|jamais)\\s)\\b(?:aumente|aumentar|suba|subir|passe|passar|eleve|elevar|reduza|reduzir|diminua|diminuir|baixe|baixar|abaixe|abaixar|dobre|dobrar|duplique|duplicar|leve|levar|ajuste|ajustar|mude|mudar)\\s+${PT_SLOT}(?:de\\s+${TARGET}\\s+)?(?:para|pra|a|até|em)\\s+${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:não|nao|nunca|jamais)\\s)\\b(?:tome|use|aplique|injete|administre|comece\\s+(?:com|a\\s+tomar)|passe\\s+a\\s+(?:tomar|usar|aplicar))\\s+${PT_SLOT}${TARGET}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:não|nao|nunca|jamais)\\s)\\b(?:pule|omita|suspenda|interrompa|dobre|duplique|divida|parta)\\s+${PT_SLOT}${med}`,
      "i",
    ),
    new RegExp(
      `(?<!\\b(?:não|nao|nunca|jamais)\\s)\\b(?:pare|deixe)\\s+de\\s+(?:tomar|usar|aplicar|injetar)\\b`,
      "i",
    ),
    // Stop or drop a named medication or a drug class: "pare o
    // anticoagulante", "tire a metformina".
    new RegExp(
      `(?<!\\b(?:não|nao|nunca|jamais)\\s)\\b(?:pare|largue|abandone|tire|retire)\\s+${PT_SHORT}${med}`,
      "i",
    ),
    // The same behind a recommending cue, with the verb in the infinitive.
    // A referral ("antes", "converse", "pergunte", "se") or a negation ends it.
    new RegExp(
      `\\b(?:voc[êe]\\s+(?:deve|deveria|pode|poderia|precisa)|recomendo|sugiro|considere|experimente|tente|vale\\s+a\\s+pena|seria\\s+(?:bom|melhor))(?:(?!\\b(?:não|nao|nunca|jamais|antes|sem|pergunte|consulte|converse|fale|se)(?![${LETTER}]))[^.?!]){0,40}?\\b(?:(?:parar|deixar)\\s+de\\s+(?:tomar|usar|aplicar|injetar)\\b|(?:pular|omitir|suspender|interromper|dobrar|duplicar|dividir|parar)\\s+${PT_SLOT}${med})`,
      "i",
    ),
    // An extra, another or one more of a medication: "tome um comprimido a
    // mais", "tome outra dose", "tome mais uma insulina".
    new RegExp(
      `(?<!\\b(?:não|nao|nunca|jamais)\\s)\\b(?:tome|use|aplique|injete|acrescente|adicione)\\s+${PT_SHORT}(?:(?:um|uma|dois|duas|três|\\d+)\\s+${PT_SHORT}${med}[^.?!]{0,20}?(?:\\ba\\s+mais\\b|\\bextras?\\b|\\badiciona(?:l|is)\\b)|(?:outr[oa]s?|mais\\s+(?:um|uma))\\s+${PT_SHORT}${med})`,
      "i",
    ),
  ],
  dose: [
    // aumente / suba / passe a dose para|a|até|em N unit
    new RegExp(
      `\\b(?:aumente|aumentar|suba|subir|passe|passar|eleve|elevar)\\s+(?:a\\s+|sua\\s+|a\\s+sua\\s+)?(?:dose\\s+)?(?:para|pra|a|até|em)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // reduza / diminua / baixe a dose para|a|até|em N unit
    new RegExp(
      `\\b(?:reduza|reduzir|diminua|diminuir|baixe|baixar|abaixe|abaixar)\\s+(?:a\\s+|sua\\s+|a\\s+sua\\s+)?(?:dose\\s+)?(?:para|pra|a|até|em)\\s+[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    // A recommending cue in front of a drug amount. `ml` is left out: "tente
    // beber 2000 ml de água por dia" is hydration advice.
    new RegExp(
      `\\b(?:considere|experimente|tente|voc[êe]\\s+deveria|voc[êe]\\s+deve|recomendo|sugiro)\\b[^.?!]{0,40}\\b[\\d.,]+\\s*${DRUG_UNIT}${UNIT_END}`,
      "i",
    ),
    new RegExp(
      `\\b(?:pr[óo]xima|nova)\\s+(?:dose|etapa)\\b[^.?!]{0,30}\\b[\\d.,]+\\s*${DOSE_UNIT}${UNIT_END}`,
      "i",
    ),
    /\b(?:dobr\w*|duplic\w*|pul(?:e|ar)|suspend\w*|interromp\w*|pare\s+de\s+tomar|parar\s+de\s+tomar)\b[^.?!]{0,25}\b(?:doses?|comprimidos?|rem[ée]dios?|medicamentos?|medica[çc]|insulina|inje[çc])[^.?!]{0,40}\b(?:por\s+(?:\d+|um|uma|dois|duas|tr[êe]s|quatro)\s+(?:dias?|semanas?|m[êe]s|meses)|para\s+(?:ver|testar|experimentar))\b/i,
  ],
  risk: [
    /\brisco\s+(?:de|é\s+de|fica\s+em|está\s+em)\s+(?:aproximadamente\s+|cerca\s+de\s+|uns\s+|~)?\d{1,3}\s*%/i,
    /\b\d{1,3}\s*%\s+(?:de\s+)?(?:risco|probabilidade|chance)/i,
    new RegExp(`\\b${RISK_NOUN_PT}\\b[^.?!]{0,40}\\d{1,3}\\s*%`, "i"),
    new RegExp(`\\d{1,3}\\s*%[^.?!]{0,40}\\b${RISK_NOUN_PT}\\b`, "i"),
    new RegExp(`\\b${RISK_NOUN_PT}\\b[^.?!]{0,40}\\b${PCT_WORD_PT}\\b`, "i"),
    new RegExp(`\\b${PCT_WORD_PT}\\b[^.?!]{0,40}\\b${RISK_NOUN_PT}\\b`, "i"),
    new RegExp(`\\b${HORIZON_PT}\\b[^.?!]{0,40}${QUAL_NUM_PT}`, "i"),
    new RegExp(`${QUAL_NUM_PT}[^.?!]{0,40}\\b${HORIZON_PT}\\b`, "i"),
    new RegExp(`\\b${ENGINE}\\b[^.?!]{0,50}${QUAL_NUM_PT}`, "i"),
    new RegExp(`${QUAL_NUM_PT}[^.?!]{0,50}\\b${ENGINE}\\b`, "i"),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_PT})\\b[^.?!]{0,60}${RESULT_VERB_PT}`,
      "i",
    ),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_PT})\\b[^.?!]{0,60}${RISK_BAND_PT}`,
      "i",
    ),
    new RegExp(
      `\\b(?:${ENGINE}|${HORIZON_PT})\\b[^.?!]{0,40}${RISK_VERDICT_PT}`,
      "i",
    ),
  ],
  causal: [
    /\bporque\b/i,
    /\bpor\s+causa\s+d/i,
    /\bdevido\s+[aà]/i,
    /\bcaus(?:a|am|ou|aram|ado|ada|ando)\b/i,
    /\bprovoc\w*/i,
    /\blev(?:ou|aram)\s+[aà]/i,
    /\bresult(?:ou|aram)\s+(?:em|d[eoa])\b/i,
    /\bem\s+raz[ãa]o\s+d/i,
    /\bem\s+decorr[êe]ncia\s+d/i,
    /\bgra[çc]as\s+[aà]/i,
    /\brespons[áa]ve(?:l|is)\s+(?:por|pel[oa]s?)\b/i,
    /\bculpa\s+d/i,
  ],
  continuation:
    /\b(?:continue\s+(?:tomando|usando|com|a\s+tomar)|siga\s+(?:tomando|com)|mantenha|conforme\s+(?:prescrito|receitado|orientado|combinado)|como\s+(?:prescrito|receitado|de\s+costume|sempre|antes)|de\s+acordo\s+com\s+a\s+(?:receita|prescri))/i,
  changeStem:
    /\b(?:aument|reduz|diminu|dobr|duplic|omit|suspend|interromp|baix(?:e|ar|ando)\b|abaix|elev(?:e|ar)\b|sub(?:a|ir)\b|pul(?:e|ar|ando)\b|parar?\s+de\s+tomar)\w*/i,
};
