import type { Doc } from "../_generated/dataModel";
import { WEEKLY_DIGEST_EVENT } from "../rules";

export const USSD_SCREEN_LIMIT = 182;
export const USSD_BACK_INPUT = "0";
export const USSD_SHORT_CODE = "*265*39#";
const DIAL_STRING = /^\*?\d+(\*\d+)+#?$/;
const MAX_HISTORY_DAYS = 5;

type Language = Doc<"guardians">["language"];
type Localised = Record<Language, string>;
type ExpectationStatus = Doc<"expectations">["status"];

export type UssdChild = {
  name: string;
  balanceKes: number;
  today: ExpectationStatus | null;
  history: { serviceDate: string; status: ExpectationStatus }[];
};

export type UssdGuardian = {
  language: Language;
  optedOutTypes: readonly string[];
  children: UssdChild[];
};

export type UssdEffect =
  | { kind: "toggleOptOut"; eventType: string }
  | { kind: "updateMsisdn"; msisdn: string };

export type UssdReply = { text: string; done: boolean; effect?: UssdEffect };

export type UssdRequest = { sessionId: string; msisdn: string; input: string };

export const NOTIFICATION_TYPES: { eventType: string; label: Localised }[] = [
  { eventType: "meal.tapped", label: { en: "Meal eaten", sw: "Amekula" } },
  { eventType: "meal.missed", label: { en: "Meal missed", sw: "Amekosa" } },
  { eventType: "wallet.topped_up", label: { en: "Top-up", sw: "Malipo" } },
  { eventType: "wallet.low_balance", label: { en: "Low balance", sw: "Salio chini" } },
  { eventType: "wallet.depleted", label: { en: "Depleted", sw: "Salio limeisha" } },
  { eventType: "wallet.depletion_forecast", label: { en: "Forecast", sw: "Utabiri" } },
  { eventType: WEEKLY_DIGEST_EVENT, label: { en: "Weekly", sw: "Kila wiki" } },
];

const MainOption = { Status: "1", Balance: "2", History: "3", Notifications: "4", ChangeNumber: "5" } as const;
const ConfirmOption = { Yes: "1", No: "2" } as const;

const COPY = {
  main: {
    en: "Dishi\n1. Status today\n2. Balance\n3. Last 5 meals\n4. Notifications\n5. Change number",
    sw: "Dishi\n1. Hali ya leo\n2. Salio\n3. Chakula 5 za mwisho\n4. Arifa\n5. Badilisha nambari",
  },
  notRegistered: {
    en: "This number is not registered. Ask your school to link it.",
    sw: "Nambari hii haijasajiliwa. Uliza shule iiunganishe.",
  },
  noChildren: { en: "No child is linked to this number.", sw: "Hakuna mtoto aliyeunganishwa na nambari hii." },
  invalid: { en: `Invalid option. Dial ${USSD_SHORT_CODE} again.`, sw: `Chaguo si sahihi. Piga ${USSD_SHORT_CODE} tena.` },
  whichChild: { en: "Which child?", sw: "Mtoto gani?" },
  ate: { en: "ate today.", sw: "amekula leo." },
  notYet: { en: "has not eaten yet today.", sw: "bado hajakula leo." },
  missed: { en: "missed today's meal.", sw: "amekosa chakula cha leo." },
  noService: { en: "No meal service today.", sw: "Hakuna chakula leo." },
  balance: { en: "balance: KES", sw: "salio: KES" },
  noHistory: { en: "no meal days recorded yet.", sw: "hakuna siku za chakula bado." },
  historyAte: { en: "ate", sw: "alikula" },
  historyMissed: { en: "missed", sw: "alikosa" },
  historyPending: { en: "pending", sw: "inasubiri" },
  notifications: { en: "Alerts (pick to switch)", sw: "Arifa (chagua kubadilisha)" },
  back: { en: "0. Back", sw: "0. Rudi" },
  on: { en: "ON", sw: "ON" },
  off: { en: "OFF", sw: "OFF" },
  alertsNow: { en: "alerts now", sw: "arifa sasa" },
  enterNumber: { en: "Enter new number (07XXXXXXXX)", sw: "Weka nambari mpya (07XXXXXXXX)" },
  invalidNumber: { en: "That is not a valid Kenyan mobile number.", sw: "Hiyo si nambari sahihi ya simu ya Kenya." },
  confirmNumber: { en: "Send alerts to", sw: "Tuma arifa kwa" },
  yesNo: { en: "1. Yes\n2. No", sw: "1. Ndiyo\n2. Hapana" },
  numberUpdated: { en: "Number updated. Alerts now go to", sw: "Nambari imebadilishwa. Arifa sasa zinaenda" },
  cancelled: { en: "No change made.", sw: "Hakuna mabadiliko." },
} satisfies Record<string, Localised>;

const KENYAN_MOBILE = /^(?:\+?254|0)(7\d{8}|1\d{8})$/;

export function canonicalMsisdn(raw: string): string | null {
  const match = KENYAN_MOBILE.exec(raw.trim());
  return match ? `+254${match[1]}` : null;
}

export function msisdnVariants(raw: string): string[] {
  const canonical = canonicalMsisdn(raw);
  if (!canonical) {
    return [raw];
  }
  const national = canonical.slice("+254".length);
  return [canonical, `254${national}`, `0${national}`];
}

export function parseUssdRequest(params: URLSearchParams): UssdRequest | null {
  const sessionId = params.get("SESSIONID");
  const msisdn = params.get("MSISDN");
  if (!sessionId || !msisdn) {
    return null;
  }
  return { sessionId, msisdn, input: stripDialString(params.get("INPUT") ?? "", params.get("USSDCODE")) };
}

// The first hit carries the dialed code itself in INPUT, not an empty string.
function stripDialString(input: string, ussdCode: string | null): string {
  return input === ussdCode || DIAL_STRING.test(input) ? "" : input;
}

export function advanceInputs(inputs: readonly string[], input: string): string[] {
  if (input === "") {
    return [...inputs];
  }
  if (input === USSD_BACK_INPUT && inputs.length > 0) {
    return inputs.slice(0, -1);
  }
  return [...inputs, input];
}

function con(text: string): UssdReply {
  return { text: `CON ${text}`, done: false };
}

function end(text: string, effect?: UssdEffect): UssdReply {
  return { text: `END ${text}`, done: true, effect };
}

function pickByNumber<T>(items: readonly T[], input: string | undefined): T | undefined {
  const index = Number(input) - 1;
  return Number.isInteger(index) ? items[index] : undefined;
}

function numbered(labels: readonly string[]): string {
  return labels.map((label, index) => `${index + 1}. ${label}`).join("\n");
}

function displayDate(serviceDate: string): string {
  const [, month, day] = serviceDate.split("-");
  return `${day}/${month}`;
}

function todayLine(language: Language, child: UssdChild): string {
  const status: Record<ExpectationStatus, Localised> = { fulfilled: COPY.ate, pending: COPY.notYet, missed: COPY.missed };
  return child.today === null ? COPY.noService[language] : `${child.name} ${status[child.today][language]}`;
}

function historyLine(language: Language, child: UssdChild): string {
  if (child.history.length === 0) {
    return `${child.name}: ${COPY.noHistory[language]}`;
  }
  const status: Record<ExpectationStatus, Localised> = {
    fulfilled: COPY.historyAte,
    missed: COPY.historyMissed,
    pending: COPY.historyPending,
  };
  const lines = child.history
    .slice(0, MAX_HISTORY_DAYS)
    .map((day) => `${displayDate(day.serviceDate)} ${status[day.status][language]}`);
  return `${child.name}:\n${lines.join("\n")}`;
}

function childAnswer(language: Language, option: string, child: UssdChild): UssdReply {
  if (option === MainOption.Status) {
    return end(todayLine(language, child));
  }
  if (option === MainOption.Balance) {
    return end(`${child.name} ${COPY.balance[language]} ${child.balanceKes}`);
  }
  return end(historyLine(language, child));
}

function childBranch(guardian: UssdGuardian, inputs: readonly string[]): UssdReply {
  const { language, children } = guardian;
  if (children.length === 0) {
    return end(COPY.noChildren[language]);
  }
  if (children.length === 1) {
    return childAnswer(language, inputs[0], children[0]);
  }
  if (inputs.length === 1) {
    return con(`${COPY.whichChild[language]}\n${numbered(children.map((child) => child.name))}`);
  }
  const child = pickByNumber(children, inputs[1]);
  return child ? childAnswer(language, inputs[0], child) : end(COPY.invalid[language]);
}

function notificationsMenu(guardian: UssdGuardian): UssdReply {
  const { language, optedOutTypes } = guardian;
  const rows = NOTIFICATION_TYPES.map(({ eventType, label }) => {
    const state = optedOutTypes.includes(eventType) ? COPY.off : COPY.on;
    return `${label[language]} ${state[language]}`;
  });
  return con(`${COPY.notifications[language]}\n${numbered(rows)}\n${COPY.back[language]}`);
}

function notificationsBranch(guardian: UssdGuardian, inputs: readonly string[]): UssdReply {
  const { language, optedOutTypes } = guardian;
  if (inputs.length === 1) {
    return notificationsMenu(guardian);
  }
  const type = pickByNumber(NOTIFICATION_TYPES, inputs[1]);
  if (!type) {
    return end(COPY.invalid[language]);
  }
  const nowOn = optedOutTypes.includes(type.eventType);
  const state = nowOn ? COPY.on : COPY.off;
  return end(`${type.label[language]} ${COPY.alertsNow[language]} ${state[language]}`, {
    kind: "toggleOptOut",
    eventType: type.eventType,
  });
}

function changeNumberBranch(guardian: UssdGuardian, inputs: readonly string[]): UssdReply {
  const { language } = guardian;
  if (inputs.length === 1) {
    return con(COPY.enterNumber[language]);
  }
  const msisdn = canonicalMsisdn(inputs[1]);
  if (!msisdn) {
    return end(COPY.invalidNumber[language]);
  }
  if (inputs.length === 2) {
    return con(`${COPY.confirmNumber[language]} ${msisdn}?\n${COPY.yesNo[language]}`);
  }
  if (inputs[2] === ConfirmOption.Yes) {
    return end(`${COPY.numberUpdated[language]} ${msisdn}`, { kind: "updateMsisdn", msisdn });
  }
  if (inputs[2] === ConfirmOption.No) {
    return end(COPY.cancelled[language]);
  }
  return end(COPY.invalid[language]);
}

export function renderUssd(guardian: UssdGuardian | null, inputs: readonly string[]): UssdReply {
  if (!guardian) {
    return end(COPY.notRegistered.en);
  }
  if (inputs.length === 0) {
    return con(COPY.main[guardian.language]);
  }
  switch (inputs[0]) {
    case MainOption.Status:
    case MainOption.Balance:
    case MainOption.History:
      return childBranch(guardian, inputs);
    case MainOption.Notifications:
      return notificationsBranch(guardian, inputs);
    case MainOption.ChangeNumber:
      return changeNumberBranch(guardian, inputs);
    default:
      return end(COPY.invalid[guardian.language]);
  }
}
