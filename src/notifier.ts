import type { MatchEvaluation, RawJob } from "./types.js";

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export async function sendDiscordNotification(
  persona: string,
  job: RawJob,
  evaluation: MatchEvaluation,
): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("⚠️ DISCORD_WEBHOOK_URL not set in .env. Skipping notification.");
    return;
  }

  // Color code: Green for strong match (80+), Amber for moderate match (60-79)
  const embedColor = evaluation.matchScore >= 80 ? 0x2ecc71 : 0xf1c40f;

  const fields: DiscordEmbedField[] = [
    {
      name: "🎯 Target Persona",
      value: `\`${persona.toUpperCase()}\``,
      inline: true,
    },
    {
      name: "📊 Match Score",
      value: `**${evaluation.matchScore}/100** (${evaluation.verdict})`,
      inline: true,
    },
    {
      name: "✨ Key Matches",
      value:
        evaluation.keyMatches.length > 0
          ? evaluation.keyMatches.map((m) => `• ${m}`).join("\n")
          : "None identified",
      inline: false,
    },
  ];

  if (evaluation.potentialGaps.length > 0) {
    fields.push({
      name: "⚠️ Gaps / Trade-offs",
      value: evaluation.potentialGaps.map((g) => `• ${g}`).join("\n"),
      inline: false,
    });
  }

  const payload = {
    username: "Job Match Agent",
    embeds: [
      {
        title: `${job.title} @ ${job.company}`,
        url: job.url,
        description: evaluation.summary,
        color: embedColor,
        fields: fields,
        footer: {
          text: `ID: ${job.id}`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Discord webhook failed with status ${res.status}: ${res.statusText}`);
    }
  } catch (err) {
    console.error("Error sending Discord notification:", err);
  }
}
