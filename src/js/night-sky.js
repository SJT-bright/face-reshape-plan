/* A small, decorative star field. CSS owns the animation; removing the view
   disconnects its visibility listener. No timers, video access or network. */
class NightSky extends HTMLElement {
  connectedCallback() {
    if (!this.childElementCount) {
      let seed = 73;
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const stars = document.createDocumentFragment();
      for (let i = 0; i < 54; i++) {
        const star = document.createElement('i');
        star.style.cssText = `left:${random() * 100}%;top:${random() * 100}%;--size:${.8 + random() * 1.6}px;--duration:${12 + random() * 16}s;--delay:-${random() * 30}s;`;
        stars.append(star);
      }
      this.append(stars);
    }
    this._visibility = () => this.toggleAttribute('paused', document.hidden);
    this._visibility();
    document.addEventListener('visibilitychange', this._visibility);
  }
  disconnectedCallback() {
    document.removeEventListener('visibilitychange', this._visibility);
  }
}
customElements.define('night-sky', NightSky);
