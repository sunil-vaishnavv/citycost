/**
 * Variant prose banks for research-synth — seed picks differ per place/kind/guide family.
 */

import type { GuideFamily } from './guide-contracts.js';
import type { SectionKind } from './section-strategies.js';

export function pickVariant<T>(seed: number, arr: T[]): T {
  return arr[Math.abs(seed) % arr.length]!;
}

export function openerFor(
  kind: SectionKind,
  seed: number,
  ctx: {
    place: string;
    cities: string[];
    /** Extra city names for country guides (examples only). */
    exampleCities?: string[];
    guideFamily?: GuideFamily;
    heading: string;
    fact: string;
    fact2: string;
    pain: string;
    criterion: string;
    mistake: string;
    neighbourhoods: string[];
    transportOpts: string[];
    healthcare: string[];
    labelA: string;
    labelB: string;
    linkA: string;
    linkB: string;
    mdLink: (href: string, label: string) => string;
  }
): string[] {
  const {
    place,
    cities,
    exampleCities = [],
    guideFamily = 'supporting',
    heading,
    fact,
    fact2,
    pain,
    criterion,
    mistake,
    neighbourhoods,
    transportOpts,
    healthcare,
    labelA,
    labelB,
    linkA,
    linkB,
    mdLink,
  } = ctx;
  const p = (n: number) => seed + n * 17;
  const isComparison = guideFamily === 'comparison' && cities.length >= 2;
  const isCountry = guideFamily === 'country';
  const examples =
    exampleCities.length >= 3
      ? exampleCities.slice(0, 5).join(', ')
      : cities.length
        ? cities.slice(0, 4).join(', ')
        : '';

  switch (kind) {
    case 'intro':
      if (isCountry) {
        return [
          pickVariant(p(1), [
            `Cost of living in ${place} is a national story first — metros, mid-size cities, and smaller towns do not share one monthly total.`,
            `${place} budgets only make sense when you separate national patterns from city examples.`,
            `Start with how ${place} prices housing, food, and transport country-wide, then use cities as illustrations.`,
          ]),
          pickVariant(p(2), [
            `This guide covers national cost drivers, regional gaps, and a typical monthly stack — not a two-city duel.`,
            `You will get a country-level planning frame, then short city examples where they clarify the range.`,
          ]),
          examples
            ? pickVariant(p(3), [
                `City names such as ${examples} appear as examples only — they are not the thesis of the page.`,
                `Expect wide spreads between places like ${examples}; treat them as samples, not the whole country.`,
              ])
            : `Pick a city shortlist later; first lock the national lines that move every budget.`,
        ];
      }
      return [
        pickVariant(p(1), [
          `Rent stretch is usually the first number that decides whether ${place} feels workable.`,
          `Most people under-estimate ${place} until they put housing and the first-month pile on one sheet.`,
          `If ${place} only "feels" expensive, you do not have a budget yet — you have a vibe.`,
          `Start ${place} planning with after-rent cash, not with restaurant Instagram.`,
          `${place} only becomes clear once housing and setup cash sit on the same page.`,
        ]),
        pickVariant(p(2), [
          `This guide walks through housing, food, transport, and the first-month cash pile so you can set a realistic range.`,
          `You will get a planner's path through the month — not a travel brochure.`,
          `The goal is a defensible monthly range before you sign or book anything long.`,
        ]),
        isComparison
          ? pickVariant(p(3), [
              `If you are weighing ${cities[0]} against ${cities[1]}, hold lifestyle constant and compare after-rent cash, not brochure vibes.`,
              `${cities[0]} vs ${cities[1]} only helps when dining and housing quality stay fixed in the comparison.`,
              `Keep ${cities[0]} and ${cities[1]} on identical lifestyle rules, then compare the cash left after rent.`,
            ])
          : pickVariant(p(3), [
              `Neighbourhood choice inside ${place} usually moves the total more than a national average.`,
              `Get local about rent and commute before you trust any single index.`,
              `City-level habits — not brochure vibes — decide whether the month closes.`,
            ]),
      ];
    case 'who':
      return [
        pickVariant(p(1), [
          `Students, remote workers, and families need different stress tests for ${place}.`,
          `${place} rewards different audiences differently — a solo remote worker is not a family of four.`,
          `Read this only if you need cash-flow clarity for ${place} before you sign anything.`,
          `Audience matters in ${place}: the same rent can be fine for one person and impossible for another.`,
        ]),
        pickVariant(p(2), [
          `A solo remote worker can absorb a longer commute; a family usually cannot.`,
          `Families feel school runs and larger flats; remote workers feel desk days and quiet leases.`,
          `If kids or dependents are in the plan, stress-test space and healthcare earlier.`,
        ]),
        pickVariant(p(3), [
          `Skip this page if you only want sightseeing tips — the rest is cash-flow mechanics.`,
          `Tourist tips will not help here; this is budgeting mechanics.`,
          `If you are not weighing a real move, the rest of the page will feel dry — on purpose.`,
        ]),
      ];
    case 'overview':
      return [
        pickVariant(p(1), [
          `Think of ${place} as five lines: housing, food, transport, healthcare buffer, and setup cash.`,
          `A workable ${place} month is a stack, not a single average.`,
          `Group ${place} costs the way a planner would: fixed housing first, then habits, then buffers.`,
          `${place} totals make sense only when the big five lines are written down.`,
        ]),
        pickVariant(p(2), [
          `Housing swings the total; the other lines rarely rescue a rent that is already too high.`,
          `If rent is wrong, food savings will not save the month.`,
          `Get housing into range before you optimize coffee or gym spend.`,
        ]),
        fact ||
          pickVariant(p(3), [
            `Where a quote is missing, leave the cell blank and keep moving — fake precision helps nobody.`,
            `Blank cells beat invented prices.`,
            `Unknown lines stay unknown until a quote arrives.`,
          ]),
      ];
    case 'housing':
      return [
        pickVariant(p(1), [
          `In ${place}, the listing rent is rarely the move-in number.`,
          `Housing in ${place} is where budgets usually break — or quietly work.`,
          `Treat ${place} rent as a package: lease length, inclusions, deposit, and commute.`,
          `${place} flats look cheap until bonds and agency fees land in the same week.`,
          `The ${place} housing line fails when people compare headline rent only.`,
        ]),
        neighbourhoods.length
          ? `${neighbourhoods.join(', ')} change the math: central addresses buy time, outer ones buy space.`
          : pickVariant(p(2), [
              `Central addresses buy time; outer ones buy space — and sometimes a second transport pass.`,
              `Inner postcodes cost cash; outer ones cost minutes.`,
              `Distance is a currency in ${place} — spend it knowingly.`,
            ]),
        pickVariant(p(3), [
          `Ask what is included (heating, internet, furniture) and how long the lease locks you in.`,
          `Inclusions and lease length matter as much as the monthly figure.`,
          `A short lease with high fees can cost more than a longer one with a higher rent.`,
        ]),
        mistake
          ? `People often regret ${mistake.toLowerCase()}.`
          : pickVariant(p(4), [
              `Agency fees and bonds can equal a second month of rent before you unpack.`,
              `Move-in week can quietly double the first housing payment.`,
              `Bonds are not optional padding — they are cash you need on day one.`,
            ]),
        seed % 2 === 0
          ? `If ${labelA} rent sits outside your range, look at ${mdLink(linkB, labelB)} before you stretch further.`
          : `Map commute minutes next to rent — a cheaper flat that steals two hours a day is not cheaper.`,
      ];
    case 'food':
      return [
        pickVariant(p(1), [
          `Groceries and dining out are different habits in ${place}, so budget them separately.`,
          `Food in ${place} moves with your week — cook-heavy or restaurant-heavy — not with a single index.`,
          `Build ${place} food costs from a normal week of receipts, not from a tourist weekend.`,
          `${place} food totals track habits more than they track headlines.`,
        ]),
        pickVariant(p(2), [
          `Two home-cooked weeks can offset a weekend of restaurants; the reverse also happens fast.`,
          `Delivery weeks inflate faster than people plan for.`,
          `A cook-at-home baseline makes dining out an explicit choice.`,
        ]),
        fact2 ||
          pickVariant(p(3), [
            `Imported staples and delivery apps inflate totals more than people admit in planning chats.`,
            `Convenience food is a lifestyle line, not a grocery accident.`,
            `Specialty imports can quietly beat your grocery assumption.`,
          ]),
        pickVariant(p(4), [
          `Track one week of receipts, multiply by 4.3, and you have a planning figure you can defend.`,
          `One receipt week beats three optimistic guesses.`,
          `Defensible food numbers come from receipts, not memory.`,
        ]),
      ];
    case 'transport':
      return [
        pickVariant(p(1), [
          `Decide car vs transit from where you will actually work or study in ${place}, not from a downtown map.`,
          `Transport in ${place} is a location decision dressed up as a monthly fee.`,
          `Your ${place} commute choice can erase a rent "win" in two weeks.`,
          `${place} transit only "wins" if it matches your real weekly pattern.`,
        ]),
        transportOpts.length
          ? `Options people use include ${transportOpts.join(', ')}.`
          : pickVariant(p(2), [
              `A monthly pass often beats pay-as-you-go once the commute is five days a week.`,
              `Daily tickets look fine until the fifth commute day.`,
              `Pattern first, pass second.`,
            ]),
        pickVariant(p(3), [
          `Parking and insurance can erase a "cheap" outer-suburb rent advantage.`,
          `Cars bring parking, insurance, and maintenance — not just fuel.`,
          `Add the full car stack before calling outer suburbs a bargain.`,
        ]),
        pickVariant(p(4), [
          `Test a weekly pass for a month before you commit to annual fees.`,
          `Trial the commute before you buy the year.`,
          `A one-month transit test is cheaper than a wrong annual pass.`,
        ]),
      ];
    case 'healthcare':
      return [
        pickVariant(p(1), [
          `Do not assume ${place} covers newcomers the same way residents are covered.`,
          `Healthcare planning for ${place} fails when people copy a resident's story.`,
          `Budget ${place} medical costs as eligibility plus a cash buffer, not as a slogan.`,
          `${place} coverage depends on status — check yours before you price the month.`,
        ]),
        healthcare.length
          ? `You may hear about ${healthcare.join(' and ')} — confirm eligibility with official sources, not forums.`
          : pickVariant(p(2), [
              `Confirm eligibility with official sources; indexes are not insurer quotes.`,
              `Forum stories are not your policy.`,
              `Official eligibility rules beat anecdotal coverage claims.`,
            ]),
        pickVariant(p(3), [
          `Price a routine GP visit and keep a separate emergency buffer even with a policy.`,
          `A GP visit price plus a buffer beats a vague "it'll be fine".`,
          `Keep medical cash separate from rent so a bill cannot break housing.`,
        ]),
        pickVariant(p(4), [
          `Coverage gaps show up as invoices, not as abstract risk.`,
          `Gaps arrive as bills.`,
          `Plan for the invoice you hope not to see.`,
        ]),
      ];
    case 'salary':
      return [
        pickVariant(p(1), [
          `Affordability in ${place} is take-home pay after rent, not the headline offer.`,
          `A strong offer for ${place} still has to clear housing before lifestyle talk starts.`,
          `Run ${place} salary math monthly: net pay, then rent, then everything else.`,
          `${place} stretch is after-rent cash — ignore that and the offer lies to you.`,
        ]),
        pickVariant(p(2), [
          `Front-loaded deposits can make a solid salary feel tight for the first quarter.`,
          `The first ninety days can feel poorer than the offer letter suggests.`,
          `Deposits borrow from future months unless you ring-fence them.`,
        ]),
        criterion
          ? `Rank ${criterion.toLowerCase()} before lifestyle extras.`
          : pickVariant(p(3), [
              `If rent eats more than about a third of take-home, revisit the neighbourhood before cutting food quality.`,
              `When rent share climbs, change location before you gut groceries.`,
              `High rent share is a neighbourhood problem first.`,
            ]),
        pickVariant(p(4), [
          `Convert the offer to monthly cash after tax estimates, then subtract housing.`,
          `Net monthly, minus rent, is the only stretch number that matters.`,
          `Do the after-tax month before you celebrate the offer.`,
        ]),
      ];
    case 'summary':
      if (isCountry) {
        return [
          pickVariant(p(1), [
            `Recommendation: treat ${place} as a national budget first, then shortlist 2–3 cities that match your rent and commute needs.`,
            `Bottom line for ${place}: lock national housing and healthcare assumptions, then pick a city band — not a random pair.`,
            `If ${place} is your destination, decide metro vs smaller-city lifestyle before you chase a single listing.`,
          ]),
          examples
            ? `Use examples like ${examples} only to test ranges, not as the whole decision.`
            : `City examples clarify the range; they are not a substitute for a national plan.`,
          pickVariant(p(3), [
            `This week: set a country-level rent ceiling, price food/transport habits, then choose which city type you can actually fund.`,
            `Next actions: national stack on one sheet, city shortlist of three, then two local quotes in your top pick.`,
          ]),
        ];
      }
      if (isComparison) {
        return [
          pickVariant(p(1), [
            `Recommendation: pick ${cities[0]} if commute flexibility matters more; pick ${cities[1]} if your criteria reverse — hold lifestyle constant either way.`,
            `Who should choose which: match your top two criteria to ${cities[0]} vs ${cities[1]}, then commit.`,
            `Final call: score ${cities[0]} and ${cities[1]} on your top two criteria, then stop shopping for a universal winner.`,
          ]),
          `Get quotes in both cities before you treat any planning gap as final.`,
          `Do not invent a winner — invent a clearer criteria list.`,
        ];
      }
      return [
        pickVariant(p(1), [
          `This week: lock a housing range for ${place}, price food and transport from real habits, then set healthcare and setup buffers.`,
          `Leave with three actions for ${place}: housing range, habit-based food/transport, and a setup cash pile.`,
          `Close the loop on ${place} by deciding a rent ceiling before you negotiate anything else.`,
          `Your next move on ${place}: get two housing quotes, then rebuild the month around the higher one.`,
          `Finish ${place} planning with a rent ceiling, two habit lines, and a setup reserve.`,
        ]),
        pickVariant(p(2), [
          `Get two local quotes before you treat any planning number as final.`,
          `Replace planning guesses with signed or written quotes as soon as you can.`,
          `Until quotes arrive, keep the higher planning number.`,
        ]),
        pickVariant(p(3), [
          `If the stack still will not close, widen the buffer or change neighbourhood — do not invent a prettier total.`,
          `A broken stack means a different neighbourhood or a higher income — not a prettier spreadsheet.`,
          `When numbers refuse to close, change the inputs, not the arithmetic.`,
        ]),
      ];
    case 'pros':
      return [
        pickVariant(p(1), [
          isComparison
            ? pickVariant(p(11), [
                `Upsides differ: ${cities[0]} may win on one axis while ${cities[1]} wins on another — name them without soft-pedaling.`,
                `Start with strengths, not a fake balance: what ${cities[0]} does well is not what ${cities[1]} does well.`,
                `List real advantages on each side before you score the pair.`,
              ])
            : isCountry
              ? `National upsides in ${place} are real — name them without turning the section into a two-city scorecard.`
              : `Concrete upsides in ${place} are worth listing without a fake "but also" in the same breath.`,
          `Transit and lease norms in ${place} can be real upsides — name those wins plainly.`,
          `Strengths in ${place} matter only if they show up in after-rent cash.`,
          `Clear wins in ${place} are worth listing without watering them down mid-sentence.`,
        ]),
        criterion
          ? `If ${criterion.toLowerCase()} is your priority, look for neighbourhoods that win on that axis.`
          : pickVariant(p(2), [
              `Predictable lease norms and usable transit reduce surprise costs for many movers.`,
              `Clear lease rules and usable transit are underrated money savers.`,
              `Reliability in housing process is a real financial upside.`,
            ]),
        pickVariant(p(3), [
          `Those strengths only help if your after-rent cash still clears food and transport.`,
          `Upsides do not cancel a rent line you cannot carry.`,
          `Keep the strengths — and still do the stretch math.`,
          `None of the upsides matter if housing already breaks the month.`,
        ]),
      ];
    case 'cons':
      return [
        pickVariant(p(1), [
          `Expect deposit-heavy move-ins and competitive rentals in ${place}.`,
          `Friction in ${place} usually shows up as cash timing, not as a pretty index chart.`,
          `The honest downsides in ${place} are front-loaded costs and thin rental choice in peak months.`,
          `Slow decision-makers lose listings fast in ${place} peak months.`,
          `In ${place}, peak-season deposits are the quiet tax most movers under-count.`,
        ]),
        pain
          ? `Pressure often shows up around ${pain.toLowerCase()}.`
          : pickVariant(p(2), [
              `Headline rent that ignores utilities is a common trap.`,
              `Utilities left out of the listing are still your problem.`,
              `Incomplete rent quotes create false confidence.`,
            ]),
        pickVariant(p(3), [
          `Write the ${place} risk on the worksheet so it does not arrive as a surprise invoice.`,
          `Named ${place} risks are budgetable; unnamed ones become crises.`,
          `Put the ${place} friction in writing before it shows up as a bill.`,
          `Capture the downside in numbers while you still have options.`,
        ]),
      ];
    case 'comparison':
      if (isCountry) {
        return [
          pickVariant(p(1), [
            `Inside ${place}, major cities diverge on rent stretch and daily costs — treat that as a regional map, not a duel.`,
            examples
              ? `Compare cost bands across ${examples} as samples of how ${place} varies.`
              : `Compare cost bands across major ${place} cities as samples of national spread.`,
          ]),
          `A cheaper city on one line can still lose if deposits or commute wipe the gap.`,
          `Use city pages for examples, then return to the national budget frame.`,
        ];
      }
      return [
        isComparison
          ? pickVariant(p(1), [
              `Hold lifestyle constant, then compare ${cities[0]} and ${cities[1]} on rent stretch, food, and commute.`,
              `${cities[0]} vs ${cities[1]} only works if you freeze dining and housing quality assumptions.`,
              `Put ${cities[0]} and ${cities[1]} on the same lifestyle rules, then compare after-rent cash.`,
            ])
          : `Hold lifestyle constant when you contrast neighbourhoods inside ${place}.`,
        pickVariant(p(2), [
          `A cheaper index on one line can lose if deposits or transit wipe the gap.`,
          `One cheap category is not a win if move-in cash erases it.`,
          `Watch the full stack, not the prettiest single index.`,
        ]),
        fact || `Side-by-side city pages beat memory when the difference is thin.`,
        seed % 2 === 0
          ? `Open ${mdLink(linkA, labelA)} beside ${mdLink(linkB, labelB)} and write both monthly stacks on one sheet.`
          : `Prefer the place that wins your top two criteria, not every category.`,
      ];
    default:
      return [
        pickVariant(p(1), [
          `For ${heading.toLowerCase()} in ${place}, stay tied to monthly cash impact.`,
          `${heading} only matters in ${place} when it changes monthly cash.`,
          `Keep ${heading.toLowerCase()} practical: what does it do to the month in ${place}?`,
          `Treat ${heading.toLowerCase()} as a cash question for ${place}, not a slogan.`,
        ]),
        fact ||
          pickVariant(p(2), [
            `If a figure is missing, leave it unknown and move on.`,
            `Missing figures stay blank until evidence arrives.`,
            `Do not invent a number to feel finished.`,
          ]),
        criterion
          ? `Weigh ${criterion.toLowerCase()} against housing first.`
          : `Weigh the trade-off against housing and take-home pay first.`,
      ];
  }
}
