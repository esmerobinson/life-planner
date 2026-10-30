import { useNavigate } from "react-router-dom";
import { CHECKIN_HASH, MORNING_HASH } from "./journal/JournalPage";

/** The Home card (desktop and phone): two buttons into the Journal's two parts. */
export function JournalCard() {
  const navigate = useNavigate();
  return (
    <section className="journal-card-home" aria-label="Journal">
      <h2>Journal</h2>
      <div className="btn-group">
        <button type="button" onClick={() => navigate(`/journal${MORNING_HASH}`)}>
          Morning pages
        </button>
        <button type="button" onClick={() => navigate(`/journal${CHECKIN_HASH}`)}>
          Daily check-in
        </button>
      </div>
    </section>
  );
}
