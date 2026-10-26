/** Simplified Chinese forms of the existing dose, risk and causal contracts. */
import {
  DRUG_UNIT,
  UNIT_END,
  ENGINE,
  medicationExtras,
  unlessDeferred,
  type LocaleBank,
} from "../shared";
const ZH_GAP = "[^。！？.!?\\n]";
const ZH_MED_NOUN =
  "(?:药物|药品|药片|片剂|胶囊|剂量|药量|服药量|给药量|用药|服药|胰岛素|注射剂|吸入剂)";
const ZH_MED_CLASS =
  "(?:抗凝药|抗凝剂|抗血小板药|降压药|降糖药|降脂药|他汀(?:类药物)?|利尿剂|抗抑郁药|安眠药|止痛药|血液稀释剂|[β贝塔]-?受体阻滞剂)";
const ZH_COUNT_UNIT = "(?:片|粒|颗|支|滴|喷|揿|单位)";
const ZH_MASS_UNIT = "(?:毫克|微克|国际单位)";
const ZH_NUMBER = "(?:[\\d.,]+|半|一|二|两|三|四|五|六|七|八|九|十)";
const ZH_TARGET = `(?:[\\d.,]+\\s*(?:${DRUG_UNIT}${UNIT_END}|${ZH_MASS_UNIT}${UNIT_END})|${ZH_NUMBER}\\s*${ZH_COUNT_UNIT})`;
const ZH_LEAD =
  "(?:^\\s*(?:[-*•]\\s*|\\d+[.)、]\\s*)?(?:(?:今天|今晚|明天|下周|早上|晚上|睡前)(?:起|开始)?\\s*)?|[：:；;，,]\\s*|(?:请|建议你|建议您|建议|你应该|您应该|你需要|您需要|你可以|您可以|最好|不妨|考虑)\\s*)";
const ZH_DEFERRAL =
  "[?？]|不要|不可|不能|不应|不建议|勿|禁止|只有|除非|是否|医生|医师|药师|医护|处方者|咨询|商量|讨论";
const ZH_CHANGE =
  "(?:增加|减少|提高|降低|上调|下调|调整|加大|减小|加量|减量|增量|减半|加倍)";
const ZH_TAKE = "(?:服用|口服|注射|吸入|服下)";

const ZH_RISK_NOUN = "(?:风险|概率|可能性)";
const ZH_HORIZON =
  "(?:(?:10|十)\\s*年|终生|终身)\\s*(?:心血管|心脏病|卒中|中风|死亡|ASCVD)?\\s*风险";
const ZH_QUAL_NUM =
  "(?:\\d{1,3}(?:[.,]\\d+)?\\s*[%％]|百分之\\s*(?:[\\d.,]+|[零〇一二两三四五六七八九十百点]+)|(?:评分|分值|得分)(?:为|是|约为|约)?\\s*\\d+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?\\s*分)";
const ZH_RISK_BAND =
  "(?:(?:高|较高|中|中等|中度|低|较低|临界)风险(?:组|人群|等级|分档|类别|区间))";
const ZH_RISK_VERDICT =
  "(?:(?:为|是|属于|处于|落在|归为|显示|提示|表明|看起来|仍然)(?:较|很|明显|显著)?(?:高|升高|偏高|中等|中度|临界)|较高|偏高|升高|显著升高)";

export const bank: LocaleBank = {
  vocabulary: (names) =>
    `(?:${ZH_MED_NOUN}|${medicationExtras(ZH_MED_CLASS, names)})`,
  doseChangeClass: (med) => [
    new RegExp(
      `${ZH_LEAD}(?:把|将)${ZH_GAP}{0,15}?${med}${ZH_GAP}{0,12}?${ZH_CHANGE}${ZH_GAP}{0,8}?${ZH_TARGET}`,
      "i",
    ),
    new RegExp(
      `${ZH_LEAD}(?:把|将)?(?:你的|您的|今晚的|晚间的)?${med}${ZH_GAP}{0,12}?${ZH_CHANGE}${ZH_GAP}{0,8}?${ZH_TARGET}`,
      "i",
    ),
    new RegExp(
      `${ZH_LEAD}(?:每天|每日|今晚|早晚)?(?:继续|保持)?${ZH_TAKE}${ZH_GAP}{0,12}?${ZH_TARGET}`,
      "i",
    ),
    unlessDeferred(
      ZH_DEFERRAL,
      new RegExp(
        `${ZH_LEAD}(?:把|将)?${med}${ZH_GAP}{0,10}?(?:减半|加倍|停掉|暂停|停用|跳过|${ZH_CHANGE}(?:一些|一点)?)(?:吧|试试|看看|。|！|$)`,
        "i",
      ),
    ),
    unlessDeferred(
      ZH_DEFERRAL,
      new RegExp(
        `${ZH_LEAD}(?:停止服用|暂停服用|停用|停服|跳过)${ZH_GAP}{0,8}?${med}|${ZH_LEAD}(?:停药|加药|减药)(?:吧|试试|看看|。|！|$)`,
        "i",
      ),
    ),
    unlessDeferred(
      ZH_DEFERRAL,
      new RegExp(
        `${ZH_LEAD}(?:增加|减少|提高|降低|上调|下调|减半|加倍)${ZH_GAP}{0,6}?${med}`,
        "i",
      ),
    ),
    unlessDeferred(
      ZH_DEFERRAL,
      new RegExp(
        `${ZH_LEAD}(?:再|多|额外|另外)(?:多)?${ZH_TAKE}${ZH_GAP}{0,8}?(?:${ZH_TARGET}|${med})|${ZH_LEAD}(?:把|将)?${med}${ZH_GAP}{0,6}?(?:再|多|额外)(?:多)?${ZH_TAKE}${ZH_GAP}{0,6}?${ZH_TARGET}`,
        "i",
      ),
    ),
  ],
  dose: [
    new RegExp(
      `${ZH_LEAD}(?:加量|增量|减量|调整剂量|提高剂量|降低剂量|升到|降到|升至|降至)(?:到|至|为)?\\s*${ZH_TARGET}`,
      "i",
    ),
    new RegExp(
      `${ZH_LEAD}(?:下一(?:个)?剂量|新剂量)(?:是|为|设为|调整为)?\\s*${ZH_TARGET}`,
      "i",
    ),
  ],
  risk: [
    new RegExp(`${ZH_RISK_NOUN}${ZH_GAP}{0,18}${ZH_QUAL_NUM}`, "i"),
    new RegExp(`${ZH_QUAL_NUM}${ZH_GAP}{0,18}${ZH_RISK_NOUN}`, "i"),
    new RegExp(`${ZH_HORIZON}${ZH_GAP}{0,30}${ZH_QUAL_NUM}`, "i"),
    new RegExp(`${ZH_QUAL_NUM}${ZH_GAP}{0,30}${ZH_HORIZON}`, "i"),
    new RegExp(`${ENGINE}${ZH_GAP}{0,40}${ZH_QUAL_NUM}`, "i"),
    new RegExp(`${ZH_QUAL_NUM}${ZH_GAP}{0,40}${ENGINE}`, "i"),
    new RegExp(
      `(?:${ENGINE}|${ZH_HORIZON})${ZH_GAP}{0,30}${ZH_RISK_BAND}`,
      "i",
    ),
    new RegExp(
      `(?:${ENGINE}|${ZH_HORIZON})${ZH_GAP}{0,20}${ZH_RISK_VERDICT}`,
      "i",
    ),
  ],
  causal: [
    /因为/,
    /由于/,
    /(?:导致|造成|引起|使得|归因于|得益于|多亏了)/,
    /(?:原因是|是[^。！？.!?\n]{1,20}的结果)/,
  ],
  continuation:
    /(?:继续(?:按医嘱|按处方)?服用|保持原(?:来)?剂量|按医嘱(?:继续)?服用|按处方(?:继续)?服用|照常服用)/,
  changeStem:
    /(?:增加|减少|提高|降低|上调|下调|调整|加大|减小|加量|减量|增量|减半|加倍|停药|停用|停服|停掉|暂停|跳过|额外|再多|多服|加药|减药)/,
};
