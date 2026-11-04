import bookSprite from "../assets/sprites/book-16.png";

/**
 * The reading list's book: the 16×16 pixel book from the sprite designer's set (round 1,
 * icons.png frame "bookicon"), copied out as its own PNG. Shown only at whole-number scales
 * (16 or 32px) with pixelated scaling, so every pixel stays square. Decorative: the words
 * beside it say what it is.
 */
export function BookIcon({ size = 16 }: { size?: 16 | 32 }) {
  return <img className="pixel-icon" src={bookSprite} alt="" width={size} height={size} />;
}
