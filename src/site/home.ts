import { brandLogo } from '../brand';
import wahooLogo from '../../logo/brands/wahoo.png';
import eliteLogo from '../../logo/brands/elite.svg';
import sarisLogo from '../../logo/brands/saris.svg';
import garminLogo from '../../logo/brands/garmin.svg';
import tacxLogo from '../../logo/brands/tacx.png';
import stravaLogo from '../../logo/brands/strava.svg';
import { ROUTES, getRouteDef } from '../routes/definitions';
import { FEATURED_IDS, PLANS, TRAINING_METHOD, planById, planStats } from '../training/plans';
import { mulberry32 } from '../util/math';
import type { RiderColors, RiderPose } from '../world/riders';
import { authConfig, currentUser, signIn, signInWithGoogle, signOut, signUp, type AccountUser, type AuthConfig } from './auth';
import { bindTrainingCatalog, trainingMain } from './trainingPage';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(cfg: { client_id: string; callback: (resp: { credential: string }) => void }): void;
      renderButton(el: HTMLElement, cfg: Record<string, string | number>): void;
    };
  };
}

export async function startSite(kind: 'home' | 'training' = 'home'): Promise<void> {
  if (kind === 'training') {
    document.title = 'Training plans — CycleBuddy';
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      'CycleBuddy training plans for every kind of rider. Weeks of workouts for FTP, sweet spot, climbing, sprinting, fondos, triathlon and masters.',
    );
  }
  document.documentElement.classList.add('site', 'site-booting');
  if (kind === 'training') document.documentElement.classList.add('site-plans');
  const root = document.getElementById('app') as HTMLElement;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  root.innerHTML = pageHtml(kind);
  bindTrainingCatalog(root);
  if (kind === 'training') {
    bootPhase = 'done';
    document.getElementById('site-loading')?.classList.add('hidden');
    document.documentElement.classList.remove('site-booting');
  } else {
    placeBootLogo(false);
    window.addEventListener('resize', () => {
      if (bootPhase === 'center') placeBootLogo(false);
    });
    void document.fonts?.ready.then(() => {
      if (bootPhase === 'center') placeBootLogo(false);
    });
  }

  let user: AccountUser | null = null;
  let config: AuthConfig = { ready: false, googleClientId: '', message: '' };

  const loadAccount = async (): Promise<'ready' | 'down' | 'unavailable'> => {
    try {
      [config, user] = await Promise.all([authConfig(), currentUser()]);
      return config.ready ? 'ready' : 'unavailable';
    } catch (err) {
      config = {
        ready: false,
        googleClientId: '',
        message: err instanceof Error ? err.message : 'The account server is not running.',
      };
      return 'down';
    }
  };

  // The API listens only after MongoDB connects, so the first page load can miss it.
  for (let attempt = 0; attempt < 8; attempt++) {
    const status = await loadAccount();
    if (status !== 'down') break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const auth = document.getElementById('auth') as HTMLElement;
  const form = document.getElementById('auth-form') as HTMLFormElement;
  let mode: 'signin' | 'signup' = 'signin';

  const paint = () => {
    const nav = document.getElementById('nav-actions') as HTMLElement;
    const hero = document.getElementById('hero-actions');
    const cta = document.getElementById('cta-actions') as HTMLElement;
    const hello = document.getElementById('hero-hello');
    if (user) {
      if (hello) hello.textContent = `Signed in as ${user.name}`;
      const riding = `<a class="btn primary big" href="/play">Enter the game</a><button class="btn ghost big" type="button" data-signout>Sign out</button>`;
      nav.innerHTML = `<span class="site-user">${escapeHtml(user.name)}</span><a class="btn primary" href="/play">Ride</a><button class="btn ghost" type="button" data-signout>Sign out</button>`;
      if (hero) hero.innerHTML = riding;
      cta.innerHTML = riding;
    } else {
      if (hello) hello.textContent = 'yourcyclebuddy.com';
      const guest = `<button class="btn primary big" type="button" data-auth="signup">Create an account</button><button class="btn ghost big" type="button" data-auth="signin">Sign in</button>`;
      nav.innerHTML = `<button class="btn ghost" type="button" data-auth="signin">Sign in</button><button class="btn primary" type="button" data-auth="signup">Create an account</button>`;
      if (hero) hero.innerHTML = guest;
      cta.innerHTML = guest;
    }
  };

  const setMode = (next: 'signin' | 'signup') => {
    mode = next;
    auth.classList.toggle('signup', next === 'signup');
    const title = document.getElementById('auth-title') as HTMLElement;
    const submit = document.getElementById('auth-submit') as HTMLButtonElement;
    const switcher = document.getElementById('auth-switch') as HTMLButtonElement;
    title.textContent = next === 'signup' ? 'Create your account' : 'Sign in';
    submit.textContent = next === 'signup' ? 'Create an account' : 'Sign in';
    switcher.textContent = next === 'signup' ? 'Already riding? Sign in' : 'New here? Create an account';
    const password = form.elements.namedItem('password') as HTMLInputElement;
    password.autocomplete = next === 'signup' ? 'new-password' : 'current-password';
    clearError();
  };

  const showAccountStatus = () => {
    const setup = document.getElementById('auth-setup') as HTMLElement;
    if (!config.ready && config.message) {
      setup.textContent = config.message;
      setup.classList.remove('hidden');
    } else setup.classList.add('hidden');
  };

  const openAuth = async (next: 'signin' | 'signup') => {
    if (!config.ready) await loadAccount();
    setMode(next);
    showAccountStatus();
    auth.classList.remove('hidden');
    const field = (next === 'signup' ? form.elements.namedItem('name') : form.elements.namedItem('email')) as HTMLInputElement;
    field.focus();
  };

  const closeAuth = () => auth.classList.add('hidden');

  const showError = (message: string) => {
    const el = document.getElementById('auth-error') as HTMLElement;
    el.textContent = message;
  };
  const clearError = () => showError('');

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const authButton = target.closest('[data-auth]');
    if (authButton) void openAuth(authButton.getAttribute('data-auth') === 'signup' ? 'signup' : 'signin');
    if (target.closest('[data-signout]')) {
      void signOut()
        .then(async () => {
          // Leave nothing of this account in the browser for the next person.
          const [{ IndexedDbStorage }, { clearLocalAccountData }] = await Promise.all([
            import('../storage/indexedDb'),
            import('../storage/localOwner'),
          ]);
          await clearLocalAccountData(new IndexedDbStorage());
        })
        .catch((err) => console.error(err))
        .finally(() => {
          user = null;
          paint();
        });
    }
    if (target.closest('[data-close-auth]') || target === auth) closeAuth();
  });

  document.getElementById('auth-switch')?.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAuth();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      if (!config.ready) await loadAccount();
      if (!config.ready) {
        showAccountStatus();
        showError(config.message || 'Accounts are not connected yet.');
        return;
      }
      const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
      const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
      const password = (form.elements.namedItem('password') as HTMLInputElement).value;
      const confirm = (form.elements.namedItem('confirm') as HTMLInputElement).value;
      if (mode === 'signup' && password !== confirm) {
        showError('The two passwords do not match.');
        return;
      }
      const submit = document.getElementById('auth-submit') as HTMLButtonElement;
      submit.disabled = true;
      const run = mode === 'signup' ? signUp(name, email, password) : signIn(email, password);
      void run
        .then(() => {
          location.assign('/play');
        })
        .catch((err: unknown) => {
          showError(err instanceof Error ? err.message : 'Could not sign in.');
          submit.disabled = false;
        });
    })();
  });

  paint();
  if (config.googleClientId) void mountGoogle(config.googleClientId, showError);
  const params = new URLSearchParams(location.search);
  const asked = params.get('auth');
  if (asked === 'signin' || asked === 'signup') {
    openAuth(asked);
    history.replaceState(null, '', '/');
  }

  // The 3D hero (three.js, the world, the route builder) is about 1 MB of script.
  // Fetch it after the page has painted so the page and the loader show first.
  if (kind === 'home') {
    afterFirstPaint(() => {
      loadWorld(canvas).catch((err: unknown) => {
        console.error('The hero world could not load', err);
        finishBoot();
      });
    });
  }
  watchReveal(root);
}

function watchReveal(root: ParentNode): void {
  const nodes = [...root.querySelectorAll<HTMLElement>('.reveal')];
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const node of nodes) node.classList.add('in');
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.2 },
  );
  for (const node of nodes) observer.observe(node);
}

function icon(id: string): string {
  const body: Record<string, string> = {
    loop: '<path d="M16 6a10 10 0 1 1-7 3"/><path d="M6 4v6h6"/>',
    peak: '<path d="M4 24 L12 8 L16 16 L20 10 L28 24Z"/>',
    season: '<rect x="6" y="7" width="20" height="18" rx="2"/><path d="M6 12h20M11 5v4M21 5v4"/>',
    flag: '<path d="M8 5v22"/><path d="M8 6h12l-2.5 4L20 14H8"/>',
    heart: '<path d="M16 26s-9-5.5-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.5-9 12-9 12z"/>',
    radio: '<path d="M8 14a12 12 0 0 1 16 0"/><path d="M11 17a7 7 0 0 1 10 0"/><circle cx="16" cy="22" r="1.7" fill="currentColor" stroke="none"/>',
    camera: '<rect x="5" y="9" width="22" height="15" rx="2"/><circle cx="16" cy="16.5" r="4"/><path d="M12 9l1.5-3h5L20 9"/>',
    chart: '<path d="M6 26V6M6 26h20"/><path d="M10 20v6M16 14v12M22 9v17"/>',
    arch: '<path d="M6 26V14a10 10 0 0 1 20 0v12"/><path d="M6 18h20"/>',
    riders: '<circle cx="11" cy="9" r="2.2"/><circle cx="21" cy="11" r="2.2"/><path d="M7 26l3-8h3l2 8M17 26l2-7h4l3 7"/>',
    file: '<path d="M9 4h9l6 6v18H9z"/><path d="M18 4v6h6M12 16h8M12 21h8"/>',
    bike: '<circle cx="9" cy="22" r="4"/><circle cx="23" cy="22" r="4"/><path d="M9 22l5-9h6l3 9M14 13l4 9"/>',
    sun: '<circle cx="16" cy="16" r="4"/><path d="M16 5v3M16 24v3M5 16h3M24 16h3M8 8l2 2M22 22l2 2M24 8l-2 2M10 22l-2 2"/>',
    map: '<path d="M5 8l7-3 8 3 7-3v19l-7 3-8-3-7 3z"/><path d="M12 5v19M20 8v19"/>',
    check: '<path d="M7 17l6 6L25 9"/>',
    jersey: '<path d="M11 6l5 3 5-3 6 4-3 4v14H8V14L5 10z"/>',
  };
  return `<svg class="ico" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${body[id] ?? ''}</svg>`;
}

function pageHtml(kind: 'home' | 'training'): string {
  return `
    <div class="site-page">
      <header class="site-nav">
        <a class="brand" href="/">${brandLogo()}</a>
        <nav class="site-links" aria-label="On this page">
          <a href="/#modes">Modes</a>
          <a href="/training-plans"${kind === 'training' ? ' aria-current="page"' : ''}>Training</a>
          <a href="/#worlds">Worlds</a>
          <a href="/#ride">The ride</a>
          <a href="/#trainers">Trainers</a>
          <a href="/#strava">Strava</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <div class="site-nav-actions" id="nav-actions"></div>
      </header>
      ${kind === 'training' ? trainingMain() : `
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow" id="hero-hello">yourcyclebuddy.com</p>
          <h1 class="hero-logo">${brandLogo()}</h1>
          <p class="lede">Indoor cycling in your browser. Free rides, hill-climb races, a full season as a team leader, and training plans. Your smart trainer makes the hills harder. Free account. No subscription.</p>
          <div class="hero-actions" id="hero-actions"></div>
        </div>
        <a class="scroll-cue" href="#modes">Scroll</a>
      </section>
      <section class="stat-band">
        <div class="stat-strip" aria-label="At a glance">
          <div><b>${ROUTES.length}</b><span>roads to ride</span></div>
          <div><b>AI riders</b><span>race them uphill</span></div>
          <div><b>No fee</b><span>nothing monthly</span></div>
          <div><b>${PLANS.length}</b><span>training plans</span></div>
        </div>
      </section>
      <section class="site-section mode-intro" id="modes">
        <div class="site-wrap">
          <div class="mode-grid">
            <a class="mode-card reveal" href="#free-ride">
              ${icon('loop')}
              <p class="mode-kicker">Play now</p>
              <h3>Free ride</h3>
              <p>Pick a road and ride for as long as you want. There is no start line and nobody to beat.</p>
            </a>
            <a class="mode-card reveal" href="#race">
              ${icon('flag')}
              <p class="mode-kicker">Play now</p>
              <h3>Hill-climb race</h3>
              <p>One race, up one hill, against AI riders. The first rider to the top wins.</p>
            </a>
            <a class="mode-card reveal" href="#training">
              ${icon('chart')}
              <p class="mode-kicker">Play now</p>
              <h3>Training plans</h3>
              <p>Choose a full plan and follow the workouts. There is one for every kind of rider.</p>
            </a>
            <a class="mode-card reveal" href="#career">
              ${icon('season')}
              <p class="mode-kicker">Play now</p>
              <h3>Career</h3>
              <p>Lead a Continental team, then try to climb into the World Tour. Your results stay with you.</p>
            </a>
          </div>
        </div>
      </section>
      <section class="site-section" id="free-ride">
        <div class="site-wrap modes-split reveal">
          <div>
            <p class="eyebrow">Free ride</p>
            <h2>Ride at your own pace</h2>
          </div>
          <div>
            <p class="section-lead">Free ride is a normal training day. Pick a road, connect your trainer, and pedal at your own pace. Stop after twenty minutes, or keep going. There is no start line and nobody to beat.</p>
            <ul class="plain-list">
              <li>Your power, cadence and heart rate come straight from the trainer</li>
              <li>Choose between 5 different camera angles</li>
              <li>Choose your starting point and enjoy scenery from your favorite part of the route</li>
            </ul>
          </div>
        </div>
      </section>
      <section class="site-section site-section-alt" id="race">
        <div class="site-wrap">
          <p class="eyebrow reveal">Hill-climb race</p>
          <h2 class="reveal">Race other riders to the top of a hill</h2>
          <p class="section-lead reveal">A hill-climb is one race, up one hill. You ride against AI riders. The first rider to the top wins.</p>
          <div class="race-points">
            <article class="reveal"><b>You pick who you race</b><span>Choose how many AI riders join you, from the best Career climbers down. The strongest W/kg is the best climber. The others sit just under that and spread down to the slowest. Riders who are close can still pass each other.</span></article>
            <article class="reveal"><b>You all start together</b><span>A short countdown gives you time to clip in. Then everyone pedals up the same hill. A small flag shows when one kilometre is left.</span></article>
            <article class="reveal"><b>You see your place</b><span>At the top, the screen shows where you finished, your time, and how hard you rode. You can save the ride as a file.</span></article>
          </div>
        </div>
      </section>
      <section class="site-section" id="training">
        <div class="site-wrap">
          <p class="eyebrow reveal">Training plans</p>
          <h2 class="reveal">Weeks of work, with a target on every interval</h2>
          <p class="section-lead reveal">Pick a plan and ride it in the game. Each workout is a percent of your FTP, and the trainer holds the watts. The plans follow the same weeks, zones and progression Zwift and Rouvy use.</p>
          <div class="method-grid">
            ${TRAINING_METHOD.map((item) => `<article class="reveal"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.text)}</span></article>`).join('')}
          </div>
          <div class="name-row">
            ${FEATURED_IDS.map((id) => {
              const plan = planById(id)!;
              const stats = planStats(plan);
              return `<article class="reveal"><span class="badge ${plan.level === 'Beginner' ? 'flat' : plan.level === 'Advanced' ? 'mountain' : 'hilly'}">${plan.level}</span><h3>${escapeHtml(plan.name)}</h3><p>${escapeHtml(plan.who)} ${stats.weeks} weeks, ${escapeHtml(stats.hoursLabel.toLowerCase())}.</p><a href="/training-plans#${plan.id}">See the weeks</a></article>`;
            }).join('')}
          </div>
          <p class="more-roads reveal"><a class="btn primary" href="/training-plans">See all ${PLANS.length} training plans</a></p>
        </div>
      </section>
      <section class="site-section" id="worlds">
        <div class="site-wrap">
          <p class="eyebrow reveal">The roads</p>
          <h2 class="reveal">Pick how hard you want today to be</h2>
          <p class="section-lead reveal">Every road has a difficulty. Some days you want an easy spin. Some days you want a long climb. You choose before you start.</p>
          <div class="name-row">
            <article class="reveal"><span class="badge flat">Flat</span><h3>Easy spinning</h3><p>Almost no climbing. Hold a steady pace for as long as you like.</p></article>
            <article class="reveal"><span class="badge hilly">Hilly</span><h3>Short climbs</h3><p>The road goes up and down. Hard work, then a chance to recover.</p></article>
            <article class="reveal"><span class="badge mountain">Mountain</span><h3>Long climbs</h3><p>Big hills that take a while. Your trainer gets heavy on the way up.</p></article>
            <article class="reveal"><span class="badge epic">Epic</span><h3>The hardest</h3><p>The longest climbs in the game, for a day when you want the biggest challenge.</p></article>
          </div>
          <p class="more-roads reveal">${ROUTES.length} roads in all: coasts, lakes, hills and high mountains, plus the valleys career races are ridden on. Pick the difficulty, then you ride.</p>
        </div>
      </section>
      <section class="site-section site-section-alt" id="ride">
        <div class="site-wrap">
          <p class="eyebrow reveal">While you ride</p>
          <h2 class="reveal">If the road goes up, pedaling gets harder</h2>
          <div class="spec">
            <article class="reveal">${icon('peak')}<div><b>Your trainer follows the road</b><span>Uphill gets heavy. Downhill gets light. You can make the hills feel easier. Your time still uses the slope of the road, so an easier feel does not change the result.</span></div></article>
            <article class="reveal">${icon('arch')}<div><b>You can see each climb</b><span>A green arch means a climb is starting. A red arch means you reached the top. You always know where you are on the hill.</span></div></article>
            <article class="reveal">${icon('jersey')}<div><b>Make the rider yours</b><span>Pick the colours of your jersey, bike, helmet and shoes. That is the rider you see on the road, and it stays on your account.</span></div></article>
            <article class="reveal">${icon('file')}<div><b>The ride is saved</b><span>When you finish, you get time, distance, climbing and power. Download a FIT file if you want the ride on Strava or Garmin.</span></div></article>
          </div>
        </div>
      </section>
      <section class="career-band" id="career">
        <div class="site-wrap">
          <p class="eyebrow reveal">Career</p>
          <h2 class="reveal">Lead the team. The trainer is your engine.</h2>
          <p class="section-lead reveal">Pick a Continental team and a season of one-day races and stage races. You choose the start list. Teammates ride for you. The bunch stays together until the last climb, then the best riders open a gap. France Tour, Italy Tour and Spanish Tour use yellow, pink and red. Points, mountains and the young rider each have a jersey. At the end of the year, the offers depend on your CYB points.</p>
          <ol class="career-steps">
            <li class="reveal"><span>01</span> Choose a team and how hard the bunch rides</li>
            <li class="reveal"><span>02</span> Tick the races you will start</li>
            <li class="reveal"><span>03</span> Tell your teammates the pace</li>
            <li class="reveal"><span>04</span> Sign a contract for next year</li>
          </ol>
        </div>
      </section>
      <section class="site-section" id="trainers">
        <div class="site-wrap trainer-plain reveal">
          <div>
            <p class="eyebrow">The setup</p>
            <h2>You already have what you need</h2>
            <p class="section-lead">A smart trainer, Chrome or Edge on a Mac or Windows computer, and a free account. Wake the trainer, close other apps that use it, and connect it from the top bar. Sign up with email or Google. There is no app to install and nothing to pay each month.</p>
            <div class="logo-row">
              <span class="logo-plate"><img src="${wahooLogo}" alt="Wahoo" /></span>
              <span class="logo-plate"><img src="${eliteLogo}" alt="Elite" /></span>
              <span class="logo-plate"><img src="${sarisLogo}" alt="Saris" /></span>
              <span class="logo-plate"><img src="${garminLogo}" alt="Garmin" /></span>
              <span class="logo-plate"><img src="${tacxLogo}" alt="Tacx" /></span>
            </div>
            <p class="fine">These connect over Bluetooth FTMS. Older Tacx trainers that only speak FE-C connect too. An ANT+-only trainer will not appear. iPhone and iPad cannot pair from the browser.</p>
          </div>
        </div>
      </section>
      <section class="site-section site-section-alt" id="strava">
        <div class="site-wrap strava-block">
          <div>
            <p class="eyebrow reveal">After the ride</p>
            <h2 class="reveal">Take the ride to Strava</h2>
            <p class="section-lead reveal">Finish a ride and download a .FIT file. Upload that file on Strava. The ride shows up there with your time, distance and power.</p>
            <ol class="strava-steps">
              <li class="reveal"><span>01</span><div><b>Finish the ride</b><span>The result stays on your account.</span></div></li>
              <li class="reveal"><span>02</span><div><b>Download .FIT</b><span>On the result screen, or later in Analytics.</span></div></li>
              <li class="reveal"><span>03</span><div><b>Upload it on Strava</b><span>You pick the file on Strava. The same file works on Garmin Connect.</span></div></li>
            </ol>
          </div>
          <div class="strava-mark reveal">
            <img src="${stravaLogo}" alt="Strava" />
          </div>
        </div>
      </section>
      <section class="site-section" id="faq">
        <div class="site-wrap">
          <p class="eyebrow reveal">FAQ</p>
          <h2 class="reveal">Questions before you ride</h2>
          <div class="faq">
            <details class="reveal">
              <summary>Is CycleBuddy free?</summary>
              <p>Yes. Create an account and ride. There is no subscription and nothing to pay each month.</p>
            </details>
            <details class="reveal">
              <summary>What do I need to start?</summary>
              <p>A smart trainer, and Chrome or Edge on a Mac or Windows computer. Sign up with email or Google. There is no app to install.</p>
            </details>
            <details class="reveal">
              <summary>Which trainers work?</summary>
              <p>Trainers that speak Bluetooth FTMS, including Wahoo, Elite, Saris, Garmin and Tacx. Older Tacx trainers that use FE-C connect too. An ANT+-only trainer will not appear. iPhone and iPad cannot pair from the browser.</p>
            </details>
            <details class="reveal">
              <summary>Can I try it without a trainer?</summary>
              <p>Yes. Choose Virtual trainer in the top bar and change your power with the arrow keys.</p>
            </details>
            <details class="reveal">
              <summary>Are the climbs real places?</summary>
              <p>No. The roads are made for the game. You pick how hard the day is: flat, hilly, mountain or epic.</p>
            </details>
            <details class="reveal">
              <summary>What is the difference between the modes?</summary>
              <p>Free ride is your own pace, for as long as you want. A hill-climb is one race up one hill against AI riders. Training plans are weeks of workouts at a percent of your FTP. Career is a season: you lead a team, pick the races, and the results stay on this computer.</p>
            </details>
            <details class="reveal">
              <summary>Can I save the ride?</summary>
              <p>Yes. Finished rides stay on your account. You can also download a FIT file for Strava or Garmin.</p>
            </details>
          </div>
        </div>
      </section>
      <section class="cta-band">
        <div class="site-wrap cta-inner">
          <div>
            <p class="eyebrow">yourcyclebuddy.com</p>
            <h2>Create a free account and ride</h2>
            <p class="section-lead">Connect the trainer you already own, pick an easy road or a hard climb, and start.</p>
          </div>
          <div class="hero-actions" id="cta-actions"></div>
        </div>
      </section>
      `}
      <footer class="site-footer">
        <div class="site-wrap footer-row">
          ${brandLogo()}
          <span>yourcyclebuddy.com</span>
          <span>Browser indoor cycling. No subscription.</span>
        </div>
      </footer>
    </div>
    <div id="auth" class="auth-layer hidden">
      <div class="auth-card glass" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="auth-close" type="button" data-close-auth aria-label="Close">&times;</button>
        <h2 id="auth-title">Sign in</h2>
        <p id="auth-setup" class="auth-setup hidden"></p>
        <div class="google-signin hidden" id="google-signin">
          <span class="btn google" aria-hidden="true"><svg class="google-mark" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/></svg>Continue with Google</span>
          <div id="google-slot"></div>
        </div>
        <p class="auth-or hidden" id="auth-or">or</p>
        <form id="auth-form" class="form">
          <label class="auth-name">Name <input name="name" maxlength="40" autocomplete="name" /></label>
          <label>Email <input name="email" type="email" autocomplete="email" required /></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label>
          <label class="auth-confirm">Confirm password <input name="confirm" type="password" autocomplete="new-password" /></label>
          <p id="auth-error" class="auth-error"></p>
          <button class="btn primary" id="auth-submit" type="submit">Sign in</button>
        </form>
        <button class="auth-switch" id="auth-switch" type="button">New here? Create an account</button>
      </div>
    </div>
    <div id="site-loading" role="status" aria-label="page is loading... it can take up to 10 seconds">
      <div class="brand boot-logo" id="boot-logo">${brandLogo()}</div>
      <div class="boot-status" id="boot-status">
        <p>page is loading... it can take up to 10 seconds</p>
        <div class="load-line" aria-hidden="true"><span></span></div>
      </div>
    </div>`;
}

async function mountGoogle(clientId: string, showError: (message: string) => void): Promise<void> {
  const wrap = document.getElementById('google-signin');
  const slot = document.getElementById('google-slot');
  const or = document.getElementById('auth-or');
  if (!wrap || !slot) return;
  try {
    await loadScript('https://accounts.google.com/gsi/client');
    const google = (window as unknown as { google?: GoogleIdentity }).google;
    if (!google) throw new Error('Google sign-in did not load.');
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (resp) => {
        void signInWithGoogle(resp.credential)
          .then(() => location.assign('/play'))
          .catch((err: unknown) => showError(err instanceof Error ? err.message : 'Google sign-in failed.'));
      },
    });
    const auth = document.getElementById('auth');
    const authHidden = auth?.classList.contains('hidden') ?? false;
    if (auth && authHidden) {
      auth.style.visibility = 'hidden';
      auth.classList.remove('hidden');
    }
    wrap.classList.remove('hidden');
    const width = Math.max(240, Math.min(400, Math.floor(wrap.clientWidth)));
    if (auth && authHidden) {
      auth.classList.add('hidden');
      auth.style.visibility = '';
    }
    google.accounts.id.renderButton(slot, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width,
    });
    or?.classList.remove('hidden');
  } catch (err) {
    slot.replaceChildren();
    wrap.classList.add('hidden');
    or?.classList.add('hidden');
    console.error(err);
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(script);
  });
}

type BootPhase = 'center' | 'flying' | 'done';
let bootPhase: BootPhase = 'center';

function placeBootLogo(fly: boolean): void {
  const boot = document.getElementById('boot-logo');
  const brand = document.querySelector('.site-nav .brand');
  const status = document.getElementById('boot-status');
  if (!(boot instanceof HTMLElement) || !(brand instanceof HTMLElement)) return;
  const box = brand.getBoundingClientRect();
  if (box.width < 1) return;
  const fitted = Math.min(2.8, (window.innerWidth - 40) / box.width);
  const scale = fly ? 1 : Math.max(1.35, fitted);
  const x = fly ? box.left : (window.innerWidth - box.width * scale) / 2;
  const y = fly ? box.top : (window.innerHeight - box.height * scale) / 2;
  boot.style.transition = fly ? 'transform .85s cubic-bezier(.22,.7,.2,1)' : 'none';
  boot.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  if (!(status instanceof HTMLElement)) return;
  if (fly) {
    status.classList.add('leave');
    return;
  }
  const bottom = y + box.height * scale;
  const height = status.offsetHeight || 64;
  const top = Math.min(window.innerHeight - height - 16, bottom + 28);
  status.style.top = `${Math.max(16, top)}px`;
}

function finishBoot(): void {
  if (bootPhase !== 'center') return;
  const loading = document.getElementById('site-loading');
  const boot = document.getElementById('boot-logo');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !(boot instanceof HTMLElement)) {
    bootPhase = 'done';
    loading?.classList.add('hidden');
    document.documentElement.classList.remove('site-booting');
    return;
  }
  bootPhase = 'flying';
  document.documentElement.classList.add('site-reveal');
  loading?.classList.add('leave');
  placeBootLogo(true);
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    bootPhase = 'done';
    loading?.classList.add('hidden');
    document.documentElement.classList.remove('site-booting');
  };
  boot.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'transform') settle();
  });
  window.setTimeout(settle, 1100);
}

function afterFirstPaint(run: () => void): void {
  requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 500 });
    else window.setTimeout(run, 50);
  });
}

async function loadWorld(canvas: HTMLCanvasElement): Promise<void> {
  const [{ World }, { excerptRoute, getRoute }, { TEAMS, teamColors }, { BRAND_IDS }] = await Promise.all([
    import('../world/world'),
    import('../routes/route'),
    import('../ai/names'),
    import('../world/bikes'),
  ]);
  const loading = document.getElementById('site-loading') as HTMLElement;
  const full = getRoute(getRouteDef('cielo'));
  // The camera looks straight down this alley. Keep that road, leave out the loop
  // behind the camera, and stop the horizon at 11 km.
  const anchorFull = (full.climbs[0]?.start ?? 1000) - 1000;
  const cut = excerptRoute(full, anchorFull - 700, anchorFull + 15000);
  const route = cut.route;
  const anchor = anchorFull - cut.from;
  const world = new World(route, canvas, null, 'high', 'golden', {
    riderCapacity: 16,
    corridor: true,
    terrain: { viewDistance: 11000, splitDistance: 1500, lod0Distance: 600, treeDensity: 0.75, treeDistance: 1500 },
  });
  world.setShowcase(anchor);
  world.setTrafficEnabled(false);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rng = mulberry32(5505);
  const pool = 12;
  // Camera sits about 28–36 m behind the anchor. Riders are born just behind it, and dropped once they are a speck.
  const bornAt = anchor - 50;
  const hideAt = anchor + 145;
  const dress = (): RiderColors => {
    const team = TEAMS[Math.floor(rng() * TEAMS.length)];
    const colors = teamColors(team, rng);
    if (rng() < 0.6) colors.wheelBrand = BRAND_IDS[Math.floor(rng() * BRAND_IDS.length)];
    return colors;
  };
  const kits = Array.from({ length: pool }, dress);
  world.setRiderColors(kits);
  world.resize();
  const poses: RiderPose[] = kits.map(() => ({ ...blankPose() }));
  const slots = kits.map(() => ({ s: bornAt, speed: 7, lat: 0.4, alive: false, phase: 0 }));

  const spawnGroup = (lead: number) => {
    const free = slots.map((slot, i) => (slot.alive ? -1 : i)).filter((i) => i >= 0);
    if (!free.length) return;
    const count = Math.min(free.length, rng() < 0.48 ? 1 : rng() < 0.8 ? 2 : 3);
    const speed = 6.2 + rng() * 2.2;
    const lane = (rng() - 0.5) * 1.4;
    for (let k = 0; k < count; k++) {
      const i = free[k];
      const slot = slots[i];
      slot.alive = true;
      slot.speed = speed + (rng() - 0.5) * 0.4;
      slot.lat = lane + (k - (count - 1) / 2) * (0.75 + rng() * 0.3);
      slot.s = lead - k * (3.4 + rng() * 2.2);
      slot.phase = rng() * Math.PI * 2;
      world.riders.setRiderColors(i, dress());
    }
  };
  // Two riders are already in the alley, far enough apart that the road is not empty.
  const open = (i: number, s: number, lat: number) => {
    const slot = slots[i];
    slot.alive = true;
    slot.s = s;
    slot.speed = 6.6 + rng() * 1.2;
    slot.lat = lat;
    slot.phase = rng() * Math.PI * 2;
  };
  open(0, anchor + 12, 0.4);
  open(1, anchor + 46, -0.25);
  let spawnIn = 3;
  let crank = 0;

  const hero = document.querySelector('.hero');
  let heroOn = true;
  if (hero) {
    new IntersectionObserver(([entry]) => {
      heroOn = entry?.isIntersecting ?? true;
    }).observe(hero);
  }
  window.addEventListener('resize', () => world.resize());

  const started = performance.now();
  let last = started;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const showingLoader = !loading.classList.contains('hidden');
    if (!reduce) {
      crank += dt * 9.2;
      spawnIn -= dt;
      const covered = slots.some((slot) => slot.alive && slot.s > anchor - 70);
      if (spawnIn <= 0 || !covered) {
        spawnGroup(bornAt);
        spawnIn = 4.5 + rng() * 3.5;
      }
    }
    poses.forEach((pose, i) => {
      const slot = slots[i];
      if (!slot.alive) {
        pose.visible = false;
        return;
      }
      if (!reduce) slot.s += slot.speed * dt;
      if (slot.s > hideAt) {
        slot.alive = false;
        pose.visible = false;
        return;
      }
      world.poseAt(slot.s, slot.lat, pose);
      pose.crank = crank + slot.phase;
      pose.wheel = (slot.s / 0.34) % (Math.PI * 2);
      pose.effort = 0.12;
      pose.visible = true;
    });
    if (heroOn || showingLoader) world.update(dt, anchor, 0, poses);
    if (showingLoader) {
      const progress = world.loadProgress;
      if ((progress > 0.7 && now - started > 800) || now - started > 20000) finishBoot();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function blankPose(): RiderPose {
  return { x: 0, y: 0, z: 0, tx: 1, tz: 0, grade: 0, crank: 0, wheel: 0, effort: 0, visible: false };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
