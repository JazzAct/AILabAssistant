import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';

const client = new Anthropic();

/**
 * POST /api/debug
 * Body (multipart): image (file), serialLog (text), code (text), components (text)
 *
 * One-shot diagnostic: upload evidence, get a structured fix back.
 * This is the "doc v1" mode — reactive, not autonomous.
 */
export async function debugRoute(req, res) {
  const { serialLog, code, components } = req.body;
  const imageFile = req.file;

  const content = [];

  // Attach breadboard image if provided
  if (imageFile) {
    const imageData = await fs.readFile(imageFile.path);
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageFile.mimetype || 'image/jpeg',
        data: imageData.toString('base64'),
      },
    });
    // Clean up temp file
    await fs.unlink(imageFile.path).catch(() => {});
  }

  // Build the diagnostic prompt
  let prompt = 'You are an expert embedded systems debugger.\n\n';
  if (components) prompt += `Components: ${components}\n\n`;
  if (serialLog)  prompt += `Serial log:\n\`\`\`\n${serialLog}\n\`\`\`\n\n`;
  if (code)       prompt += `Code:\n\`\`\`c\n${code}\n\`\`\`\n\n`;
  if (imageFile)  prompt += 'Breadboard image attached above.\n\n';

  prompt += `Diagnose the issue and respond with JSON:
{
  "rootCause": "...",
  "confidence": "high|medium|low",
  "wiringFix": "...",        // if applicable
  "codeFix": "...",          // if applicable
  "explanation": "...",      // student-friendly explanation
  "unsafeConnections": []    // any dangerous wiring detected
}`;

  content.push({ type: 'text', text: prompt });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ raw: text });
    }

    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
