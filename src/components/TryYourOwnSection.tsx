type TryYourOwnSectionProps = {
  onBrowse: () => void
}

export default function TryYourOwnSection({ onBrowse }: TryYourOwnSectionProps) {
  return (
    <section className="panel" aria-labelledby="try-your-own-heading">
      <h2 id="try-your-own-heading">Try your own</h2>
      <div className="upload-block">
        <button
          type="button"
          className="button button-file"
          aria-describedby="upload-helper"
          onClick={onBrowse}
        >
          Upload a picture or animation
        </button>
        <p id="upload-helper" className="helper">
          JPEG, PNG, WebP, or GIF. It stays in your browser.
        </p>
      </div>
    </section>
  )
}
