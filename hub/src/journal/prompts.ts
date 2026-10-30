// The check-in prompt bank (journal brief §2), copied verbatim from checkin-prompts.json:
// 61 prompts written in our own words from her DBT workbook and the "Mindful Mornings"
// article. `starter: true` marks the 21 she starts with; the rest wait in "Choose questions".
// (The bank's safety lines are deliberately NOT here: Esme removed them from scope.)

export type PromptWhen = "morning" | "evening" | "any";

export interface Prompt {
  id: string;
  starter: boolean;
  text: string;
  /** The DBT skill, shown small under the question. */
  skill: string;
  when: PromptWhen;
  /** Where it comes from ("book p. N" is shown as "Workbook p. N"). */
  ref: string;
}

export const PROMPTS: readonly Prompt[] = [
  { id: "M1", starter: true, text: "Before you reach for your phone, find three things: one sound, one feeling against your skin, one thing you can see. What are they?", skill: "Observe", when: "morning", ref: "book p. 134; Mindful Mornings article" },
  { id: "M2", starter: true, text: "Describe how you're waking up today in plain words, as if you were reporting the weather. Say \"slow and achy\", not \"pathetic\".", skill: "Describe, non-judgmental stance", when: "morning", ref: "book p. 139; Mindful Mornings article" },
  { id: "M3", starter: false, text: "Where has your mind been: in the past, in the future, or here? Take one slow breath and bring it back to the room you're in.", skill: "Present moment", when: "any", ref: "book p. 68" },
  { id: "M4", starter: true, text: "Rest a hand just below your ribs and breathe slowly for a moment. If your wise mind had one thing to say about today, what would it be?", skill: "Wise mind", when: "any", ref: "book p. 156" },
  { id: "M5", starter: false, text: "Was there a choice today where your feelings and the facts pulled different ways? What was each side asking for?", skill: "Emotion mind / reasonable mind / wise mind", when: "evening", ref: "book p. 154–158" },
  { id: "M6", starter: true, text: "Catch one judgment you made today, about you, someone else or a situation. How would you say it as a plain description instead?", skill: "Non-judgmental stance", when: "evening", ref: "book p. 160" },
  { id: "M7", starter: false, text: "Is one thought going round and round? Imagine setting it down and watching it drift off. What's it like to watch it instead of following it?", skill: "Thought defusion", when: "any", ref: "book p. 137" },
  { id: "M8", starter: false, text: "Pick something you'll do today anyway, like tea, a shower or a walk to the shop, and give it your full attention. What did you notice that you usually miss?", skill: "One-mindfully / participate", when: "any", ref: "book p. 185" },
  { id: "M9", starter: false, text: "Choose one familiar person or place today and meet it as if it were new. What are you curious to notice?", skill: "Beginner's mind", when: "morning", ref: "book p. 165" },
  { id: "M10", starter: false, text: "Name one feeling that's here right now and where it sits in your body. You don't have to fix it, just say hello to it.", skill: "Mindful awareness of emotions", when: "any", ref: "book p. 150" },
  { id: "M11", starter: false, text: "When were you most fully *in* what you were doing today?", skill: "Participate", when: "evening", ref: "book p. 183" },
  { id: "M12", starter: false, text: "Look at one ordinary object for one minute. What did you see that you hadn't seen before?", skill: "Observe", when: "any", ref: "book p. 131" },
  { id: "D1", starter: false, text: "Think of a moment today that felt like too much. If you could replay it with a pause first, where would the pause go and what would you choose next?", skill: "REST (≈ STOP)", when: "evening", ref: "book p. 21–26" },
  { id: "D2", starter: false, text: "Rate the feeling from 0 to 10, then rate the actual problem. If the feeling is much bigger, that's a sign to cope first and act later. Which skill fits?", skill: "FTB-Cope (≈ check the facts)", when: "any", ref: "book p. 83–86" },
  { id: "D3", starter: true, text: "Which of your senses could you look after for five minutes right now: smell, sight, sound, taste or touch? What would you give it?", skill: "Self-soothing", when: "any", ref: "book p. 43–49" },
  { id: "D4", starter: false, text: "Are you pushing against something that has already happened? What might loosen if you let it be what it is, without saying it's okay?", skill: "Radical acceptance", when: "any", ref: "book p. 27–29, 77" },
  { id: "D5", starter: true, text: "In today's hard bit, what was in your hands, and what wasn't?", skill: "Radical acceptance", when: "evening", ref: "book p. 80–81" },
  { id: "D6", starter: true, text: "Write one short line you could say to yourself if today gets rough, something that has steadied you before.", skill: "Coping thoughts", when: "morning", ref: "book p. 71–76" },
  { id: "D7", starter: false, text: "When a feeling spikes, which body reset helps you most: cold water on your face, a short burst of hard movement, or slow breaths with a long out-breath? Did you use one today? *(The book advises checking with a doctor first about the cold-water and exercise skills if you have heart, blood-pressure or breathing problems, or are pregnant.)*", skill: "Physiological coping skills (≈ TIPP)", when: "any", ref: "book p. 100–112" },
  { id: "D8", starter: false, text: "What could hold your attention for twenty minutes if you needed a break from your thoughts today?", skill: "Distraction plan", when: "morning", ref: "book p. 29–42" },
  { id: "D9", starter: false, text: "Picture your calm place for a few breaths. What's one thing you can see, hear or feel there?", skill: "Safe-place visualisation", when: "any", ref: "book p. 51" },
  { id: "D10", starter: false, text: "Is there anything you'd want to have ready for a hard day? Jot one thing down.", skill: "Emergency coping plan", when: "any", ref: "book p. 96–98" },  // the bank says "any (about monthly)"; text reworded (fix round 1: no crisis plan, Esme)
  { id: "D11", starter: false, text: "What do you care about that makes today's hard part worth doing?", skill: "Values / committed action", when: "morning", ref: "book p. 55–60" },
  { id: "E1", starter: false, text: "Pick one emotional moment from today. What happened, what did you feel, and what did you feel like doing?", skill: "Recognising emotions", when: "evening", ref: "book p. 206–211" },
  { id: "E2", starter: false, text: "Was there a feeling underneath the feeling, like hurt under anger or fear under irritation?", skill: "Primary / secondary emotions", when: "any", ref: "book p. 202–203" },
  { id: "E3", starter: true, text: "Name what you're feeling in one or two words. Pleasant feelings count too.", skill: "Labelling emotions", when: "any", ref: "book p. 212; word list p. 139" },
  { id: "E4", starter: true, text: "How's your body doing today: sleep, eating, aches, energy? Is there one small thing that would help it?", skill: "Reducing physical vulnerability (≈ PLEASE)", when: "morning", ref: "book p. 221–229" },
  { id: "E5", starter: true, text: "Which thought has been hardest on you today? What backs it up, and what does it leave out?", skill: "Big-picture evidence log (≈ check the facts)", when: "any", ref: "book p. 240–247" },
  { id: "E6", starter: true, text: "Is a feeling pushing you to do something? What's the opposite action, and what's the smallest version of it you could try?", skill: "Opposite action", when: "any", ref: "book p. 263–268" },
  { id: "E7", starter: false, text: "Let one feeling be here for a minute without arguing with it. Did it change shape while you watched?", skill: "Mindfulness of emotions without judgment", when: "evening", ref: "book p. 253–255" },
  { id: "E8", starter: false, text: "Is there a feeling you've been steering around lately? It might be one to explore with your therapist rather than alone.", skill: "Emotion exposure", when: "any", ref: "book p. 255–260" },
  { id: "E9", starter: false, text: "Think of a moment that went sideways. What came just before it, and what came before that? *(Worth bringing to a session.)*", skill: "Behaviour analysis", when: "evening", ref: "book p. 268–272" },
  { id: "E10", starter: false, text: "Is there a problem behind today's feelings that could actually be solved? What's one small first step?", skill: "Problem solving", when: "any", ref: "book p. 268–275" },
  { id: "E11", starter: false, text: "What's one thing you'll do today just because you enjoy it?", skill: "Building positive emotions", when: "morning", ref: "book p. 247–251" },
  { id: "E12", starter: false, text: "Which feeling visited most this week? What do you think it was trying to tell you?", skill: "Emotions as messages", when: "evening", ref: "book p. 83, 202" },
  { id: "I1", starter: false, text: "Think of someone you talked to today. What did you notice in their face or voice?", skill: "Mindful attention", when: "evening", ref: "book p. 279–280" },
  { id: "I2", starter: false, text: "Is there something you want from someone in your life? Can you put it in one clear sentence?", skill: "Knowing what you want", when: "any", ref: "book p. 302–305" },
  { id: "I3", starter: true, text: "Is there a small request you've been putting off? How could you ask it simply and kindly, with a thank-you at the end?", skill: "Simple request (≈ DEAR MAN)", when: "morning", ref: "book p. 307–309" },
  { id: "I4", starter: false, text: "If you need to bring something up with someone, sketch it first: what happened (facts only), how you felt, what you'd like.", skill: "Assertiveness script (≈ DEAR MAN)", when: "any", ref: "book p. 309–314" },
  { id: "I5", starter: true, text: "Did you say yes to something today when you meant no? What would a warm but clear no have sounded like?", skill: "Saying no", when: "evening", ref: "book p. 317" },
  { id: "I6", starter: false, text: "In one close relationship, how balanced does it feel right now between what you want and what they want?", skill: "\"I want–they want\" balance", when: "any", ref: "book p. 285" },
  { id: "I7", starter: false, text: "How many \"shoulds\" are steering your day? Is there one you could loosen a little?", skill: "\"I want–I should\" balance", when: "morning", ref: "book p. 287" },
  { id: "I8", starter: false, text: "Did you feel the heat rise in a conversation today? What was the first warning sign in your body?", skill: "Red-flag feelings", when: "evening", ref: "book p. 297" },
  { id: "I9", starter: false, text: "How do you want to treat people, and how do you want to be treated? Did today match that?", skill: "Interpersonal values (self-respect)", when: "evening", ref: "book p. 290–291" },
  { id: "I10", starter: false, text: "Think of someone who's hard to be around. What might they be carrying that you can't see?", skill: "Compassion for others", when: "any", ref: "book p. 281" },
  { id: "I11", starter: false, text: "If a conversation went badly, what would you change next time, and what did you do well?", skill: "Analysing problem interactions", when: "evening", ref: "book p. 324" },
  { id: "K1", starter: false, text: "What's one thing that went okay today, even a tiny one?", skill: "Noticing positive events", when: "evening", ref: "book p. 276" },
  { id: "K2", starter: true, text: "Talk to yourself the way you'd talk to a friend who'd had your day. What would you say?", skill: "Self-compassion", when: "any", ref: "book p. 174–176" },
  { id: "K3", starter: false, text: "What's one kind thing you did for yourself today, or could still do before bed?", skill: "Time-out / self-care", when: "evening", ref: "book p. 66–67" },
  { id: "K4", starter: true, text: "Write one true, good thing about yourself. It doesn't have to feel big.", skill: "Self-affirming statements", when: "any", ref: "book p. 81–83" },
  { id: "K5", starter: true, text: "What's one thing you're looking forward to today, however small?", skill: "Building positive emotions", when: "morning", ref: "book p. 247" },
  { id: "K6", starter: false, text: "Who or what made today a little lighter?", skill: "Noticing positive events", when: "evening", ref: "book p. 276" },
  { id: "K7", starter: true, text: "What did you handle today that a past version of you might have found harder?", skill: "Noticing progress", when: "evening", ref: "book p. 340" },
  { id: "K8", starter: false, text: "Send a quiet good wish to yourself, then to someone you love, then to someone you barely know.", skill: "Loving-kindness", when: "any", ref: "book p. 196–197" },
  { id: "K9", starter: false, text: "What would a gentle pace look like for you today?", skill: "Self-compassion / time-out", when: "morning", ref: "book p. 66, 174" },
  { id: "K10", starter: false, text: "Which skill did you use today, even halfway? Halfway counts.", skill: "Skills practice", when: "evening", ref: "book p. 340" },
  { id: "K11", starter: false, text: "What can you let stay unfinished tonight?", skill: "Acceptance / self-kindness", when: "evening", ref: "book p. 77, 174" },
  { id: "S1", starter: true, text: "What triggered difficult feelings today?", skill: "Recognising emotions (prompting event)", when: "evening", ref: "book p. 206–207" },
  { id: "S2", starter: true, text: "What good things happened today, and why are they good for you?", skill: "Noticing positive events", when: "evening", ref: "book p. 247–251" },
  { id: "S3", starter: true, text: "If a trigger comes today, give yourself 10 minutes to breathe before anything else. Where could you go to do that?", skill: "REST + slow breathing", when: "morning", ref: "book p. 21, 110–112" },
  { id: "S4", starter: true, text: "What is the trigger pointing to? What in your world is the feeling responding to?", skill: "Emotions as messages (≈ check the facts)", when: "any", ref: "book p. 83, 207" },
];

export const PROMPT_BY_ID: ReadonlyMap<string, Prompt> = new Map(PROMPTS.map((p) => [p.id, p]));

/** The prompts active on a device that never chose: the starters. */
export const STARTER_IDS: readonly string[] = PROMPTS.filter((p) => p.starter).map((p) => p.id);

/** "Workbook p. 134" from "book p. 134; Mindful Mornings article"; null when the ref has no page. */
export function workbookPage(ref: string): string | null {
  const m = /book p\. ([0-9][0-9\u2013, ]*[0-9]|[0-9])/.exec(ref);
  return m ? `Workbook p. ${m[1]}` : null;
}
