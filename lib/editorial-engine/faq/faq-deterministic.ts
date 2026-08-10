/**
 * Deterministic expert FAQ answers — used when AI is unavailable or fails validation.
 * Intentionally avoids Writer research-synth templates.
 */

import type { ResearchPack } from '../research/schema.js';
import { classifyFaqQuestion } from './faq-validator.js';
import type { FaqItem } from './types.js';

function placeOf(research: ResearchPack): string {
  return research.primary_entity || research.topic?.title || 'this destination';
}

function cityHint(research: ResearchPack, index: number): string | null {
  const cities = research.entities?.cities?.length
    ? research.entities.cities
    : research.related_cities?.map((c) => c.label) || [];
  if (!cities.length) return null;
  return cities[index % cities.length] || null;
}

function peerCity(research: ResearchPack, index: number): string | null {
  const cities = research.entities?.cities?.length
    ? research.entities.cities
    : research.related_cities?.map((c) => c.label) || [];
  if (cities.length < 2) return null;
  return cities[(index + 1) % cities.length] || null;
}

const PADS = [
  'Add a small contingency for the unexpected so one bill does not wreck the month.',
  'Review the plan after your first fortnight on the ground and adjust quickly.',
  'Keep lifestyle upgrades optional until housing and transport are stable.',
  'Share the draft budget with a partner or mentor who will challenge soft assumptions.',
  'Prefer boring, repeatable costs over optimistic one-off estimates.',
  'If numbers still feel abstract, price a real listing and a real grocery basket this week.',
  'Document every recurring fee you discover so the second month is cleaner than the first.',
  'Protect sleep and commute time in the plan — exhaustion gets expensive too.',
];

function trimWords(text: string, index: number, min = 80, max = 140): string {
  let out = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?]$/.test(out)) out += '.';
  let words = out.split(/\s+/).filter(Boolean);
  let guard = 0;
  while (words.length < min && guard < 6) {
    const parts = out.split(/(?<=[.!?])\s+/).filter(Boolean);
    const last = parts.pop() || closing(index);
    const pad = PADS[(index + guard) % PADS.length]!;
    parts.push(pad, last);
    out = parts.join(' ');
    words = out.split(/\s+/).filter(Boolean);
    guard += 1;
  }
  if (words.length > max) {
    out = words.slice(0, max).join(' ');
    if (!/[.!?]$/.test(out)) out += '.';
  }
  return out;
}

const CLOSINGS = [
  'Write the number down once you have a neighbourhood in mind — that is when it becomes real.',
  'If the first draft of your budget feels tight, cut housing before you cut healthcare.',
  'Test the plan against a quiet month and a busy month so surprises show up early.',
  'Talk to someone already living your target lifestyle; local habits change totals fast.',
  'Keep a one-page budget and update it after every serious city shortlist change.',
  'Delay big purchases until you have lived the commute for two weeks.',
  'Use city-level signals on CityCost, then confirm quotes with landlords and insurers.',
  'Treat the first 60 days as a calibration period, not a permanent lifestyle.',
  'If two cities are close on rent, let commute time break the tie.',
  'Save the “nice to have” line for after your lease is signed.',
  'Re-run the math whenever your job location or share-house plan changes.',
  'A smaller place near work often beats a cheap place that burns hours commuting.',
  'Keep proof-of-funds and deposit cash separate from your monthly living budget.',
  'Price the boring stuff — laundry, phone, pharmacy — or it will sneak up later.',
  'If you are comparing offers, convert each to after-rent cash in the same city.',
  'Visit grocery apps for your target suburb once; it grounds food assumptions quickly.',
  'Ask about building fees and bond rules before you celebrate a low advertised rent.',
  'Students: semester math beats weekly math for knowing whether the city is viable.',
  'Families: school runs and car needs can outweigh a slightly cheaper suburb.',
  'Remote workers: coworking and café defaults can erase a “cheap city” advantage.',
];

function closing(index: number): string {
  return CLOSINGS[index % CLOSINGS.length]!;
}

function naturalLinkTip(
  research: ResearchPack,
  index: number,
  topic: 'rent' | 'cost' | 'salary' | 'general'
): string {
  const a = cityHint(research, index);
  const b = peerCity(research, index);
  const variants = [
    a && b && topic === 'rent'
      ? `If ${a} is on your shortlist, compare its rent index with ${b} on CityCost before you sign a lease.`
      : null,
    a && topic === 'cost'
      ? `For a grounded read on ${a}, open its CityCost city page and scan rent, groceries, and transport together.`
      : null,
    a && topic === 'salary'
      ? `Pair salary expectations with the CityCost purchasing-power view for ${a}, not a single national headline.`
      : null,
    a
      ? `Keep the CityCost page for ${a} open while you draft your budget so local differences stay visible.`
      : null,
    b
      ? `When ${b} is in the mix, check its CityCost profile next to your top pick before you decide.`
      : null,
    `Use CityCost city pages for the places you are seriously considering rather than a single country-wide number.`,
  ].filter(Boolean) as string[];
  return variants[index % variants.length]!;
}

function answerFor(q: string, research: ResearchPack, index: number): string {
  const place = placeOf(research);
  const kind = classifyFaqQuestion(q);
  const ql = q.toLowerCase();

  if (/utilit|electric|gas bill|internet|water bill/.test(ql)) {
    const openers = [
      `Utility bills in ${place} are usually secondary to rent, but they still move the monthly total.`,
      `Electricity and internet in ${place} vary with climate, building age, and how much you heat or cool.`,
      `Most newcomers underestimate summer cooling or winter heating costs in ${place}.`,
      `Phone, power, and water in ${place} are predictable once you know the dwelling type.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Apartments often include some charges in body corporate or rent; houses push more onto you. Ask for recent bill ranges for the exact property, not a national average. ${naturalLinkTip(research, index, 'general')} ${closing(index)}`,
      index
    );
  }

  if (/tax|taxes/.test(ql)) {
    const openers = [
      `Tax affects take-home pay in ${place} more than it changes your grocery bill.`,
      `Workers feel ${place}'s cost of living through after-tax income, not the tax brochure alone.`,
      `How expensive ${place} feels depends on net pay after withholding and compulsory contributions.`,
      `Salary offers for ${place} should be compared on take-home cash, not gross headlines.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Bracket differences, Medicare levies, and filing rules change by status. Convert any offer to monthly net, then subtract rent. ${naturalLinkTip(research, index, 'salary')} ${closing(index)}`, index);
  }

  if (/sav(e|ings)|deposit|how much should i save|first-?month/.test(ql)) {
    const openers = [
      `Save enough for bond, first month’s rent, and a setup buffer before you land in ${place}.`,
      `A move to ${place} usually needs cash reserves beyond the plane ticket.`,
      `First-month costs in ${place} cluster around housing deposits and basic setup.`,
      `Most people under-prepare liquid cash for the landing week in ${place}.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Bond alone can be multiple weeks of rent, and you still need food, transport, and a phone plan on day one. Keep this reserve separate from your ongoing monthly budget. ${naturalLinkTip(research, index, 'rent')} ${closing(index)}`, index);
  }

  if (/safe|safety|crime/.test(ql)) {
    const openers = [
      `Safety in ${place} is generally strong in everyday neighbourhood terms, and that can support higher rents in desirable areas.`,
      `People pay a premium in ${place} for neighbourhoods that feel walkable and well lit at night.`,
      `Perceived safety shapes housing demand in ${place}, which feeds into living costs.`,
      `Choosing a safer, better-connected suburb in ${place} often costs more in rent — and saves elsewhere.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Look at the block you would actually walk at night, not national rankings. Factor lighting, transit, and street activity into the rent you accept. ${naturalLinkTip(research, index, 'general')} ${closing(index)}`, index);
  }

  if (/adelaide.*sydney|sydney.*adelaide|perth.*melbourne|melbourne.*perth|compar/.test(ql) || kind === 'which') {
    const openers = [
      `City-to-city gaps inside ${place} are mostly housing and commute, not groceries.`,
      `The cheaper city in ${place} is the one where your rent band and job location align.`,
      `Comparisons across ${place} only work when you hold lifestyle constant.`,
      `Pick cities in ${place} by constraints first — rent ceiling, then commute, then lifestyle.`,
      `There is no universal winner in ${place}; there is a best fit for your constraints.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Rank housing budget and job access, then eliminate cities that fail either test. ${naturalLinkTip(research, index, 'rent')} ${closing(index)}`, index);
  }

  if (/rent|housing|apartment|lease/.test(ql)) {
    const openers = [
      `Average rent in ${place} swings hard by city and neighbourhood.`,
      `Rent is usually the largest monthly line item when people move to ${place}.`,
      `There is no single rent figure that represents all of ${place} fairly.`,
      `Housing costs in ${place} depend more on city choice than on the national average.`,
      `Advertised rents in ${place} often exclude fees that show up at lease signing.`,
      `Outer-suburb savings in ${place} can disappear if you need a car every day.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Capitals and coastal hubs often run hotter than smaller regional cities, and inner-city one-beds price differently from outer suburbs. Ask for all-in monthly housing cost including fees and utilities estimates. ${naturalLinkTip(research, index, 'rent')} ${closing(index)}`, index);
  }

  if (/grocer|food|dining|restaurant/.test(ql)) {
    const openers = [
      `Grocery spend in ${place} is manageable if you cook most meals at home.`,
      `Food costs in ${place} feel high mainly when dining out becomes the default.`,
      `Supermarket staples in ${place} are rarely the budget-breaker — restaurants are.`,
      `Your food bill in ${place} tracks habits more than the CPI headline.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Imported specialties and frequent café meals push totals up quickly, while local produce and home cooking keep them steadier. Track a two-week grocery run instead of guessing from travel memories. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`, index);
  }

  if (/transport|commute|metro|transit/.test(ql)) {
    const openers = [
      `Public transport in ${place} can replace a car in several major cities.`,
      `Commute costs in ${place} depend on whether you live near frequent transit.`,
      `Many newcomers overspend on cars in ${place} before testing transit for a month.`,
      `Transit passes in ${place} look cheap until your job sits outside the frequent network.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Monthly passes, occasional rideshares, and walking-distance housing change the math more than fuel alone. Map your likely workplace or campus against transit frequency first. ${naturalLinkTip(research, index, 'general')} ${closing(index)}`, index);
  }

  if (/health|insur|medical|doctor/.test(ql)) {
    const openers = [
      `Healthcare costs in ${place} depend on coverage status and how you use private care.`,
      `Medical expenses surprise movers in ${place} when they assume everything is free.`,
      `A realistic healthcare buffer matters as much as the headline insurance premium in ${place}.`,
      `Visa status in ${place} can change what you pay for routine care.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Public eligibility, waiting times, and private extras vary by visa and city. Price a routine GP visit and a basic dental check in your target city, then add a monthly buffer. ${naturalLinkTip(research, index, 'general')} ${closing(index)}`, index);
  }

  if (/student|universit|study|campus/.test(ql)) {
    const openers = [
      `Students can make ${place} work on a tighter budget with shared housing.`,
      `Affordability for students in ${place} hinges on rent share and part-time income rules.`,
      `${place} is student-viable in several cities if you avoid premium neighbourhoods.`,
      `A student budget in ${place} fails fastest when housing is solo and central.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Shared flats near campus, cooking at home, and a transit pass usually beat studio living. Confirm work-hour limits on your visa before you rely on a job to close the gap. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`, index);
  }

  if (/salary|wage|income|pay|earn|comfortably/.test(ql)) {
    const openers = [
      `Salary stretch in ${place} is a city story more than a country story.`,
      `What a paycheck buys in ${place} changes sharply between hubs.`,
      `Income needs in ${place} should be tested against local rent, not a national mean.`,
      `Comfortable living in ${place} starts with after-rent cash, not gross pay.`,
      `A “good salary” in ${place} can still feel tight after inner-city rent.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} A comfortable wage in one city can feel tight in another after housing. Convert offers into after-rent cash and run that number for three months of lifestyle. ${naturalLinkTip(research, index, 'salary')} ${closing(index)}`, index);
  }

  if (/visa|immigra|residence|permit/.test(ql) || (kind === 'can' && !/student|afford|remote/.test(ql))) {
    const openers = [
      `Whether you can move to ${place} depends on the visa pathway you actually qualify for.`,
      `Eligibility for living in ${place} is paperwork-first, budget-second.`,
      `A move to ${place} is possible for many people, but the route is not one-size-fits-all.`,
      `Legal entry options for ${place} decide timing and cost before rent does.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Student, skilled, partner, and temporary work routes have different cost and timing profiles. Confirm application fees, health cover requirements, and proof-of-funds rules before you resign or book flights. ${naturalLinkTip(research, index, 'general')} ${closing(index)}`, index);
  }

  if (kind === 'worth') {
    const openers = [
      `${place} is worth it when your after-housing lifestyle matches your priorities.`,
      `Whether ${place} is “worth it” depends on what you are optimizing for.`,
      `People who thrive in ${place} usually accept higher housing for specific lifestyle gains.`,
      `The move to ${place} pays off when career or education gains clear the rent premium.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Career access, education, safety, and climate can justify a premium; random FOMO rarely does. Write down the three outcomes that would make the move a success, then price those against rent. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`, index);
  }

  if (kind === 'why') {
    const openers = [
      `${place} costs what it does because housing demand clusters in a few cities.`,
      `Price pressure in ${place} usually starts with housing scarcity in popular hubs.`,
      `The cost story in ${place} is driven by where people actually want to live and work.`,
      `Demand for a handful of job hubs explains most of ${place}'s living-cost spread.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Strong job markets and amenities pull demand, which lifts rent and everyday services nearby. Secondary cities can feel calmer on the same income. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`, index);
  }

  if (/month|budget|need per|how much money/.test(ql) || kind === 'how_much') {
    const openers = [
      `Monthly needs in ${place} should be built from rent first, then living costs.`,
      `A workable monthly budget for ${place} starts with housing, not averages.`,
      `How much you need each month in ${place} is mostly a housing decision.`,
      `Your monthly total in ${place} is rent plus a short list of predictable living lines.`,
      `Budgeting for ${place} fails when people start with lifestyle wants instead of housing.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Add groceries, transport, phone/internet, healthcare buffer, and leisure after you lock a realistic rent band. Keep a first-month setup reserve for deposits and basics. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`, index);
  }

  if (/remote/.test(ql)) {
    const openers = [
      `Remote workers can afford more of ${place} if they skip premium CBD rents.`,
      `Coastal cities in ${place} work for remote pay only when housing stays disciplined.`,
      `Remote income helps in ${place}, but café-and-coworking habits can erase the edge.`,
    ];
    return trimWords(
      `${openers[index % openers.length]} Choose neighbourhoods for quiet work and transit, not tourist postcards. Track coworking and dining as real line items. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`, index);
  }

  const openers = [
    `The real cost of living in ${place} is local, not national.`,
    `Living costs in ${place} only make sense once you name a city and lifestyle.`,
    `People get ${place} wrong when they quote one country-wide figure.`,
    `${place}'s affordability changes with housing choices more than almost anything else.`,
    `Day-to-day costs in ${place} follow your city shortlist more than the country brand.`,
    `A practical view of ${place} starts with where you would actually rent.`,
    `National averages hide the real ${place} experience that renters feel each month.`,
    `Cost conversations about ${place} should name a city in the first breath.`,
  ];
  return trimWords(
    `${openers[index % openers.length]} Housing, food habits, and commute shape most of the gap between cheap and expensive experiences. Decide your city shortlist, then price a normal month — rent, groceries, transport, and a buffer. ${naturalLinkTip(research, index, 'cost')} ${closing(index)}`,
    index
  );
}

export function buildDeterministicFaqItems(
  research: ResearchPack,
  questions: string[]
): FaqItem[] {
  const place = placeOf(research);
  const qs = questions.filter(Boolean).slice(0, 20);
  while (qs.length < 6) {
    qs.push(
      [
        `What is the real cost of living in ${place}?`,
        `What is the average rent in ${place}?`,
        `How much money do I need per month in ${place}?`,
        `Are groceries expensive in ${place}?`,
        `Is healthcare expensive in ${place}?`,
        `Can students afford ${place}?`,
      ][qs.length]!
    );
  }

  return qs.map((q, index) => ({
    q,
    a: answerFor(q, research, index),
    id: `faq-${index + 1}`,
  }));
}
