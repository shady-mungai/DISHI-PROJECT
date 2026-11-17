import Link from "next/link";
import styles from "./landing.module.css";
export default function Home() {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.logo} aria-label="Mlo home">
          <span aria-hidden="true">◒</span> mlo.
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#people">Who it’s for</a>
        </nav>
        <Link className={styles.button} href="/login">
          Log in <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={styles.eyebrow}>School feeding, connected</p>
          <h1 id="hero-title">
            <em>A little care.</em>
            <br />A fuller{" "}
            <span className={styles.underline}>
              future.
              <svg viewBox="0 0 300 14" aria-hidden="true">
                <path d="M2 8C50 9.5 100 -2 298 4" />
              </svg>
            </span>
          </h1>
          <div className={styles.heroBottom}>
            <p>
              Behind every school meal is a community.
              <br />
              Mlo brings it together — from the first delivery to the last
              plate.
            </p>
            <a className={styles.textLink} href="#how-it-works">
              Discover how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        <section
          className={styles.visual}
          aria-label="Every meal is a fresh start"
        >
          <div className={styles.visualCaption}>
            <p className={styles.eyebrow}>More than a meal</p>
            <h2>
              Room to learn.
              <br />
              <em>Energy to grow.</em>
            </h2>
            <p>
              A simple purpose.
              <br />A shared responsibility.
            </p>
          </div>
          <svg
            className={styles.meal}
            viewBox="0 0 720 620"
            role="img"
            aria-label="An illustrated bowl of grains and greens, with a spoon and leaves"
          >
            <defs>
              <pattern
                id="grain"
                width="24"
                height="24"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(25)"
              >
                <path
                  d="M5 4v9M17 13v7"
                  stroke="#b5b99f"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </pattern>
            </defs>
            <path
              d="M70 490C20 330 150 100 320 78S650 170 680 350 475 610 300 582 108 600 70 490"
              fill="#b8bea2"
            />
            <circle cx="350" cy="320" r="225" fill="#e9e5d7" />
            <circle
              cx="350"
              cy="320"
              r="193"
              fill="#f7f5eb"
              stroke="#202a2d"
              strokeWidth="2"
            />
            <circle cx="350" cy="320" r="166" fill="url(#grain)" />
            <path
              d="M250 191C350 165 467 213 485 313 413 335 321 327 277 274Z"
              fill="#7c896b"
            />
            <g fill="none" stroke="#f7f5eb" strokeWidth="3">
              <path d="M292 213 451 298M318 215l9 25 39-6M358 239l5 24 44-4M399 263l4 23 30-2" />
            </g>
            <g fill="#a29a81" stroke="#f7f5eb" strokeWidth="3">
              <ellipse
                cx="278"
                cy="356"
                rx="26"
                ry="18"
                transform="rotate(-30 278 356)"
              />
              <ellipse
                cx="325"
                cy="389"
                rx="26"
                ry="18"
                transform="rotate(20 325 389)"
              />
              <ellipse cx="260" cy="408" rx="26" ry="18" />
              <ellipse
                cx="365"
                cy="351"
                rx="26"
                ry="18"
                transform="rotate(-40 365 351)"
              />
              <ellipse cx="395" cy="409" rx="26" ry="18" />
              <ellipse cx="325" cy="442" rx="26" ry="18" />
            </g>
            <path
              d="M599 189c-36 5-45 62-18 83l-31 225c-3 24 23 27 4-4l25-227c32-13 31-89-3-85Z"
              fill="#dedbcc"
              stroke="#202a2d"
              strokeWidth="2"
              transform="rotate(12 580 350)"
            />
            <g fill="#7c896b" stroke="#202a2d" strokeWidth="2">
              <path d="M58 221c46 3 67 36 65 75-44-4-66-31-65-75Z" />
              <path d="M125 248c-2-43 20-70 53-81 9 40-9 70-53 81Z" />
              <path d="m123 326 2-78" fill="none" />
            </g>
          </svg>
          <span className={styles.visualNote}>
            Good food. Better school days.
          </span>
        </section>
        <section id="how-it-works" className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>A clearer picture, every day</p>
            <h2>
              From kitchen
              <br />
              <em>to classroom.</em>
            </h2>
            <p>
              Less scattered paperwork. More time for the children. One place to
              coordinate the work that makes school meals happen.
            </p>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01 / Plan</span>
              <h3>Know what’s needed.</h3>
              <p>
                Bring pupil records and meal expectations together so teams can
                prepare for the school day.
              </p>
            </li>
            <li>
              <span>02 / Deliver</span>
              <h3>Keep food moving.</h3>
              <p>
                Declare dispatches, confirm deliveries and follow up on
                differences with a shared record.
              </p>
            </li>
            <li>
              <span>03 / Serve</span>
              <h3>Make every meal count.</h3>
              <p>
                Record meals with a pupil’s tag or a staff-assisted entry, and
                keep guardians informed.
              </p>
            </li>
          </ol>
        </section>
        <section id="people" className={styles.section}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Different roles. Shared purpose.</p>
            <h2>
              A place for
              <br />
              <em>everyone involved.</em>
            </h2>
            <p>
              The right information for each team, with access matched to their
              responsibilities.
            </p>
          </div>
          <div className={styles.roles}>
            <article>
              <span className={styles.eyebrow}>At the school</span>
              <h3>
                More care.
                <br />
                Less admin.
              </h3>
              <p>
                Manage pupils, record meal service and check deliveries in your
                school workspace.
              </p>
            </article>
            <article>
              <span className={styles.eyebrow}>On the ground</span>
              <h3>
                Supplies in step
                <br />
                with schools.
              </h3>
              <p>
                Suppliers can view forecasts, declare dispatches and reconcile
                what was delivered.
              </p>
            </article>
            <article>
              <span className={styles.eyebrow}>Across the programme</span>
              <h3>
                The detail.
                <br />
                And the bigger picture.
              </h3>
              <p>
                County teams and administrators can monitor schools, review
                exceptions and oversee operations.
              </p>
            </article>
          </div>
        </section>
        <section className={styles.cta}>
          <p className={styles.eyebrow}>For the people who make it happen</p>
          <h2>
            A better school day
            <br />
            <em>starts together.</em>
          </h2>
          <p>
            Already part of the programme?
            <br />
            Log in to open your team’s dashboard.
          </p>
          <Link className={styles.button} href="/login">
            Open your workspace <span aria-hidden="true">↗</span>
          </Link>
        </section>
      </main>
      <footer className={styles.footer}>
        <div>
          <Link href="/" className={styles.logo}>
            mlo.
          </Link>
          <p>Every meal matters.</p>
        </div>
        <p>
          School feeding.
          <br />A shared effort.
        </p>
        <a href="#hero-title">Back to top ↑</a>
      </footer>
    </div>
  );
}
