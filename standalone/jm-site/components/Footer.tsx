const DTF_PAGE = "https://buyjmmedia.com/pages/dtf-transfers";

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <a className="brand" href="/">
            <img src="/img/jm-logo.png" alt="" width={46} height={46} />
            <span>JM Digital Media</span>
          </a>
          <nav aria-label="Footer">
            <a href="/#services">Services</a>
            <a href="/#process">How it works</a>
            <a href="/#catalogs">Catalogs</a>
            <a href="/shop">Shop</a>
            <a href={DTF_PAGE}>DTF transfers</a>
            <a href="/#quote">Get a quote</a>
          </nav>
          <div className="social">
            <a href="https://www.facebook.com/buyjmmedia" target="_blank" rel="noopener" aria-label="Facebook">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M14 8.5V6.8c0-.8.5-1 1-1h2.4V2.1L14.2 2C10.9 2 10 4.3 10 6.4v2.1H7.6V12H10v10h4V12h3l.5-3.5H14z" />
              </svg>
            </a>
            <a href="https://www.instagram.com/media.jm" target="_blank" rel="noopener" aria-label="Instagram">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
            <a href="https://www.tiktok.com/@jmdigitalmedia" target="_blank" rel="noopener" aria-label="TikTok">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.1-2.8V9.1a6.3 6.3 0 1 0 5.5 6.3V8.6a7.7 7.7 0 0 0 4.4 1.4V6.6a4.4 4.4 0 0 1-4.4-4.6z" />
              </svg>
            </a>
          </div>
        </div>
        <small>© {new Date().getFullYear()} JM Digital Media, 815 2nd St, Rosenberg, TX 77471</small>
      </div>
    </footer>
  );
}
