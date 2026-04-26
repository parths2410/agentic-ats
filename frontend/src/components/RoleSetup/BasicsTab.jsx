import { useEffect, useState } from "react";

export default function BasicsTab({ role, isExisting, saving, onSave }) {
  const [title, setTitle] = useState(role?.title || "");
  const [jobDescription, setJobDescription] = useState(role?.job_description || "");
  const [validationError, setValidationError] = useState(null);

  useEffect(() => {
    setTitle(role?.title || "");
    setJobDescription(role?.job_description || "");
  }, [role?.id, role?.title, role?.job_description]);

  const dirty =
    (role?.title || "") !== title || (role?.job_description || "") !== jobDescription;

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setValidationError("Title is required");
      return;
    }
    setValidationError(null);
    onSave({ title: title.trim(), job_description: jobDescription });
  }

  return (
    <form className="basics-tab" onSubmit={handleSubmit} noValidate>
      {validationError && <p className="error">{validationError}</p>}

      <div className="field">
        <label htmlFor="role-title">Title</label>
        <input
          id="role-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Senior Backend Engineer"
        />
      </div>

      <div className="field">
        <label htmlFor="role-jd">Job description</label>
        <textarea
          id="role-jd"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the full job description here…"
          rows={14}
        />
      </div>

      <div className="basics-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || (isExisting && !dirty)}
        >
          {saving ? "Saving…" : isExisting ? "Save" : "Create role"}
        </button>
      </div>
    </form>
  );
}
