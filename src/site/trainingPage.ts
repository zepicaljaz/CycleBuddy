import { FTP_TEST_PLAN, GROUPS, PLANS, TRAINING_METHOD, planStats, type TrainingPlan } from '../training/plans';
import { barsHtml, expandBlocks, formatSession, prescribedLoad } from '../training/workout';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function levelBadge(level: TrainingPlan['level']): string {
  const tone = level === 'Beginner' ? 'flat' : level === 'Advanced' ? 'mountain' : 'hilly';
  return `<span class="badge ${tone}">${level}</span>`;
}

function planBlock(plan: TrainingPlan): string {
  const stats = planStats(plan);
  const weeks = plan.weeks.map((week) => {
    const rides = week.workouts.map((workout) => {
      const steps = expandBlocks(workout.blocks);
      const load = prescribedLoad(steps);
      return `
        <li class="plan-workout">
          <div>
            <b>${escapeHtml(workout.name)}</b>
            <span>${escapeHtml(workout.focus)} · ${formatSession(steps.at(-1)?.end ?? 0)} · TSS ${Math.round(load.tss)}</span>
            <p>${escapeHtml(workout.blurb)}</p>
          </div>
          ${barsHtml(steps, undefined, 36)}
        </li>`;
    }).join('');
    return `
      <section class="plan-week">
        <div class="week-head"><h3>${escapeHtml(week.title)}</h3>${week.recovery ? '<span class="badge flat">Easier week</span>' : ''}</div>
        <p>${escapeHtml(week.note)}</p>
        <ul>${rides}</ul>
      </section>`;
  }).join('');
  return `
    <details class="plan-block" id="${plan.id}" data-group="${plan.group}">
      <summary>
        <span class="plan-summary">
          <p class="mode-kicker">${escapeHtml(GROUPS.find((group) => group.id === plan.group)?.label ?? '')} · ${plan.weeks.length} weeks</p>
          <h3>${escapeHtml(plan.name)}</h3>
          <p>${escapeHtml(plan.who)}</p>
        </span>
        <span class="plan-facts">
          ${levelBadge(plan.level)}
          <b>${escapeHtml(stats.hoursLabel)}</b>
          <span>${stats.workouts} workouts</span>
        </span>
      </summary>
      <div class="plan-body">
        <p>${escapeHtml(plan.goal)}</p>
        ${weeks}
        <p><a class="btn primary" href="/play?plan=${plan.id}">Ride this plan</a></p>
      </div>
    </details>`;
}

export function trainingMain(): string {
  return `
    <section class="page-intro">
      <div class="site-wrap">
        <p class="eyebrow">Training plans</p>
        <h1>A plan for every kind of rider</h1>
        <p class="lede">Weeks of workouts for new riders, climbers, sprinters, time trialists, masters, fondos and race weeks. Pick one and ride it on the trainer you already own.</p>
        <div class="hero-actions" id="hero-actions"></div>
      </div>
    </section>
    <section class="site-section" id="how">
      <div class="site-wrap">
        <p class="eyebrow reveal">How a plan is built</p>
        <h2 class="reveal">The same shape as the big training apps</h2>
        <div class="method-grid">
          ${TRAINING_METHOD.map((item) => `<article class="reveal"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.text)}</span></article>`).join('')}
        </div>
      </div>
    </section>
    <section class="site-section site-section-alt" id="catalog">
      <div class="site-wrap">
        <p class="eyebrow reveal">The plans</p>
        <h2 class="reveal">${PLANS.length} plans, from a first spin to a race week</h2>
        <p class="section-lead reveal">Open a plan to see every week and every workout. Targets use the FTP you save in the game. In a workout the trainer holds the watts, and you pick the cadence. A flat road keeps your speed steady. A climb is there when you want the view.</p>
        <article class="ftp-offer reveal" id="ftp-test">
          <div>
            <p class="mode-kicker">FTP test</p>
            <h3>Set your FTP with a 20-minute effort</h3>
            <p>The first time you sign in, you type a number. Ride this when you want a measured one. Go as hard as you can hold for 20 minutes. Your FTP becomes 95% of that average, and every test is saved so you can compare them later.</p>
          </div>
          <a class="btn primary" href="/play?plan=${FTP_TEST_PLAN.id}">Ride the FTP test</a>
        </article>
        <div class="route-sort reveal" id="plan-filters">
          <button class="chip selected" type="button" data-group="all">All</button>
          ${GROUPS.map((group) => `<button class="chip" type="button" data-group="${group.id}">${escapeHtml(group.label)}</button>`).join('')}
        </div>
        <div class="plan-list">
          ${PLANS.map(planBlock).join('')}
        </div>
      </div>
    </section>
    <section class="cta-band">
      <div class="site-wrap cta-inner">
        <div>
          <p class="eyebrow">yourcyclebuddy.com</p>
          <h2>Create a free account and start a plan</h2>
          <p class="section-lead">Set your FTP, pick the plan that matches the rider you are, and ride the first workout.</p>
        </div>
        <div class="hero-actions" id="cta-actions"></div>
      </div>
    </section>`;
}

export function bindTrainingCatalog(root: ParentNode): void {
  const bar = root.querySelector('#plan-filters');
  if (!bar) return;
  bar.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-group]') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    const group = button.dataset.group ?? 'all';
    for (const chip of bar.querySelectorAll('[data-group]')) chip.classList.toggle('selected', chip === button);
    for (const plan of root.querySelectorAll<HTMLElement>('.plan-block')) {
      plan.hidden = group !== 'all' && plan.dataset.group !== group;
    }
  });
  const openFromHash = () => {
    const id = location.hash.replace('#', '');
    const el = id ? document.getElementById(id) : null;
    if (!(el instanceof HTMLDetailsElement)) return;
    el.hidden = false;
    el.open = true;
    el.scrollIntoView({ block: 'start' });
  };
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
}
