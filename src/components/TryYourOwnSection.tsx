import { useRef } from 'react'

export default function TryYourOwnSection() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="panel" aria-labelledby="try-your-own-heading">
      <h2 id="try-your-own-heading">Try your own</h2>
      <div className="upload-block">
        <button
          type="button"
          className="button button-file"
          aria-describedby="upload-helper"
          onClick={() => {
            fileInputRef.current?.click()
          }}
        >
          Upload a picture or animation
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          tabIndex={-1}
          aria-hidden="true"
        />
        <p id="upload-helper" className="helper">
          JPEG, PNG, WebP, or GIF. It stays in your browser.
        </p>
      </div>
    </section>
  )
}
