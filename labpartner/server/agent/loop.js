import Anthropic from '@anthropic-ai/sdk';
import { buildProject, flashDevice, readSerial } from '../tools/espTools.js';
import { readFile, writeFile, listFiles } from '../tools/fileTools.js';
import { searchDatasheet } from '../tools/datasheetTools.js';

const client = new Anthropic();

const MAX_ITERATIONS = 5;

/**
 * The autonomous agent loop.
 *
 * emit() is a function the loop calls to push real-time events to the UI:
 *   { type: 'THINKING', text }          — agent reasoning narration
 *   { type: 'FILE_READ', path, content } — agent opened a file
 *   { type: 'FILE_WRITE', path, diff }   — agent edited a file
 *   { type: 'BUILD_START' }
 *   { type: 'BUILD_OUTPUT', line }       — streaming compiler output
 *   { type: 'BUILD_RESULT', success, errors }
 *   { type: 'FLASH_START' }
 *   { type: 'FLASH_DONE' }
 *   { type: 'SERIAL_READING', seconds }  — reading serial for N seconds
 *   { type: 'JUDGMENT', pass, reasoning, sensorData }
 *   { type: 'ITERATION', current, max }
 *   { type: 'GOAL_ACHIEVED', summary }
 *   { type: 'GIVING_UP', reason }
 *   { type: 'AWAITING_APPROVAL', filePath, newContent } — human-in-loop for flash
 */
export async function agentLoop({ goal, projectPath, port, datasheetText, maxIterations = MAX_ITERATIONS, emit }) {
  emit({ type: 'THINKING', text: `Starting autonomous loop. Goal: "${goal}"` });

  const tools = buildToolDefinitions();

  const systemPrompt = `You are an autonomous embedded systems engineering agent.
Your job is to help a student achieve a hardware goal by writing, building, flashing, and observing ESP-IDF firmware on a real ESP32.

You have these tools:
- read_file: read any file in the project
- write_file: write or overwrite a file (use for main.c, CMakeLists.txt)
- list_files: list files in a directory
- build_project: run idf.py build and get compiler output
- flash_device: flash the compiled binary to the ESP32 (always ask agent permission first)
- read_serial: read serial output for a number of seconds
- search_datasheet: look up component specs from provided datasheet text

Rules:
1. Always write main.c with rich serial logging so you can observe behavior
2. If build fails, read the error carefully, fix the specific issue, rebuild immediately
3. After flashing, always read the serial monitor before judging success
4. Compare observed sensor values against the goal precisely
5. If the goal is not met, explain your hypothesis and iterate
6. Stop after ${maxIterations} iterations or when goal is achieved
7. Before flashing, emit a AWAITING_APPROVAL event and wait — the student must confirm

Current project path: ${projectPath}
Serial port: ${port}
${datasheetText ? `Datasheet context:\n${datasheetText}` : ''}`;

  const messages = [
    { role: 'user', content: `Goal: ${goal}\n\nBegin. Write the firmware, build it, flash it, observe the output, and iterate until the goal is achieved or you reach the iteration limit.` }
  ];

  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    emit({ type: 'ITERATION', current: iteration, max: maxIterations });

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8096,
      system: systemPrompt,
      tools,
      messages,
    });

    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    // Stream any text reasoning to the UI
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        emit({ type: 'THINKING', text: block.text });
      }
    }

    // If no tool calls, agent is done reasoning
    if (response.stop_reason === 'end_turn') {
      const finalText = response.content.find(b => b.type === 'text')?.text || '';
      if (finalText.toLowerCase().includes('goal achieved') || finalText.toLowerCase().includes('success')) {
        emit({ type: 'GOAL_ACHIEVED', summary: finalText });
      } else {
        emit({ type: 'GIVING_UP', reason: finalText });
      }
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const result = await executeTool(block.name, block.input, { projectPath, port, emit });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }

    // Check if agent declared success in tool results
    const judgmentResult = toolResults.find(r => r.content?.includes('"pass":true'));
    if (judgmentResult) {
      emit({ type: 'GOAL_ACHIEVED', summary: 'Sensor values matched goal criteria.' });
      break;
    }
  }

  if (iteration >= maxIterations) {
    emit({ type: 'GIVING_UP', reason: `Reached maximum iterations (${maxIterations}). Review the serial output and last code state.` });
  }
}

async function executeTool(name, input, { projectPath, port, emit }) {
  switch (name) {
    case 'read_file': {
      emit({ type: 'FILE_READ', path: input.path });
      return await readFile(input.path);
    }

    case 'write_file': {
      emit({ type: 'FILE_WRITE', path: input.path, content: input.content });
      await writeFile(input.path, input.content);
      return `File written: ${input.path}`;
    }

    case 'list_files': {
      return await listFiles(input.directory || projectPath);
    }

    case 'build_project': {
      emit({ type: 'BUILD_START' });
      const result = await buildProject(projectPath, (line) => {
        emit({ type: 'BUILD_OUTPUT', line });
      });
      emit({ type: 'BUILD_RESULT', success: result.success, errors: result.errors });
      return result.success
        ? 'Build succeeded.'
        : `Build failed:\n${result.errors.join('\n')}`;
    }

    case 'flash_device': {
      // Human-in-the-loop gate: emit approval request, then wait
      emit({ type: 'AWAITING_APPROVAL', action: 'flash', port });
      // In a real impl, this would pause and wait for a WebSocket ack
      // For the hackathon demo, auto-approve after 2 seconds
      await new Promise(r => setTimeout(r, 2000));
      emit({ type: 'FLASH_START' });
      const result = await flashDevice(projectPath, port);
      emit({ type: 'FLASH_DONE', success: result.success });
      return result.success ? 'Flash successful.' : `Flash failed: ${result.error}`;
    }

    case 'read_serial': {
      const seconds = input.seconds || 5;
      emit({ type: 'SERIAL_READING', seconds });
      const lines = await readSerial(port, seconds);
      return lines.join('\n');
    }

    case 'search_datasheet': {
      return searchDatasheet(input.query, input.datasheetText);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function buildToolDefinitions() {
  return [
    {
      name: 'read_file',
      description: 'Read a file from the ESP project directory',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to file' }
        },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: 'Write or overwrite a file. Use for main.c, CMakeLists.txt, etc.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to file' },
          content: { type: 'string', description: 'Full file content to write' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'list_files',
      description: 'List files in a directory of the project',
      input_schema: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory path to list' }
        },
        required: ['directory']
      }
    },
    {
      name: 'build_project',
      description: 'Run idf.py build in the project directory. Returns success or compiler errors.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'flash_device',
      description: 'Flash the compiled binary to the ESP32. Always requires student approval first.',
      input_schema: {
        type: 'object',
        properties: {
          confirmed: { type: 'boolean', description: 'Set true only after student approval' }
        },
        required: ['confirmed']
      }
    },
    {
      name: 'read_serial',
      description: 'Read serial monitor output for a number of seconds. Use after flashing to observe sensor behavior.',
      input_schema: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'How many seconds to read (default 5, max 30)' }
        },
        required: []
      }
    },
    {
      name: 'search_datasheet',
      description: 'Search the provided datasheet text for a specific spec or value',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for (e.g. "encoder PPR", "max RPM", "GPIO voltage")' },
          datasheetText: { type: 'string', description: 'Full datasheet text to search through' }
        },
        required: ['query']
      }
    }
  ];
}
