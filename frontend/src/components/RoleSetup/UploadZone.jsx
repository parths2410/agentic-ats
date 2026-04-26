import { useRef, useState } from "react";
import { api } from "../../services/api.js";

function pdfsOnly(files) {
  return Array.from(files).filter(
    (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
  );
}

export default function UploadZone({ roleId, onUploaded }) {
  const inputRef = useRef(null);
  const [staged, setStaged] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(fileList) {
    const next = pdfsOnly(fileList);
    if (next.length === 0) {
      setError("Only PDF files are accepted.");
      return;
    }
    setError(null);
    setStaged((prev) => {
      const seen = new Set(prev.map((f) => f.name + ":" + f.size));
      return [...prev, ...next.filter((f) => !seen.has(f.name + ":" + f.size))];
    });
  }

  function removeStaged(idx) {
    setStaged((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleUpload() {
    if (staged.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const result = await api.candidates.upload(roleId, staged);
      setStaged([]);
      if (inputRef.current) inputRef.current.value = "";
      if (onUploaded) onUploaded(result.candidates || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="upload-zone-wrap">
      <div
        className={`upload-zone ${dragOver ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current && inputRef.current.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          style={{ display: "none" }}
          onChange={(e) => addFiles(e.target.files)}
        />
        <p>
          <strong>Drop PDF resumes here</strong> or click to browse.
        </p>
        <p className="hint">Multi-file upload supported.</p>
      </div>

      {error && <p className="error">{error}</p>}

      {staged.length > 0 && (
        <ul className="staged-list">
          {staged.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="staged-name">{f.name}</span>
              <span className="staged-size">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                onClick={() => removeStaged(i)}
                className="btn btn-danger btn-sm"
                title="Remove from upload list"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="form-actions">
        <button
          onClick={handleUpload}
          disabled={uploading || staged.length === 0}
          className="btn btn-primary"
        >
          {uploading ? "Uploading…" : `Upload ${staged.length || ""} PDF${staged.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
