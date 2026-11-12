import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { MastraEditor } from '@mastra/editor';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { z } from 'zod';

const inputSchema = z.object({ item: z.string() });
const resumeSchema = z.object({ approved: z.boolean() });

const approval = createStep({
  id: 'approval',
  inputSchema,
  resumeSchema,
  suspendSchema: z.object({ message: z.string() }),
  outputSchema: resumeSchema,
  execute: async ({ resumeData, suspend }) => {
    if (!resumeData) {
      console.log('FIXTURE_WORKFLOW_SUSPENDED');
      return await suspend({ message: 'Fixture needs your approval' });
    }
    console.log('FIXTURE_WORKFLOW_RESUMED', resumeData.approved);
    return resumeData;
  },
});

const approvalWorkflow = createWorkflow({
  id: 'approval-workflow',
  description: 'A workflow that asks for approval and returns the decision',
  inputSchema,
  outputSchema: resumeSchema,
}).then(approval).commit();

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

function plan({ prompt, tools }: LanguageModelV3CallOptions) {
  const lastUserIndex = prompt.findLastIndex(message => message.role === 'user');
  const lastUser = JSON.stringify(prompt[lastUserIndex]);
  const toolResult = prompt.slice(lastUserIndex + 1).some(message => message.role === 'tool');
  const workflowTool = tools?.find(tool => tool.name === 'workflow-approvalWorkflow');
  if (workflowTool && !toolResult && lastUser?.includes('Start fixture workflow')) {
    return { type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: workflowTool.name,
      input: JSON.stringify({ inputData: { item: 'sample' } }) } as const;
  }
  if (workflowTool && !toolResult && lastUser?.includes('I approve the fixture')) {
    const system = prompt.find(message => message.role === 'system')?.content ?? '';
    const pending = system.match(/Analyse the suspended tools: (.+?), using the messages/);
    const suspended = pending && JSON.parse(pending[1]).find((entry: { toolName: string }) => entry.toolName === workflowTool.name);
    console.log('FIXTURE_FOLLOWUP_MODEL', Boolean(suspended));
    if (!suspended) return { type: 'text', text: 'FIXTURE_NO_SUSPENSION' } as const;
    return { type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: workflowTool.name,
      input: JSON.stringify({ ...suspended.args, suspendedToolCallId: suspended.toolCallId,
        resumeData: { approved: true } }) } as const;
  }
  return { type: 'text', text: toolResult ? 'FIXTURE_FINAL_REPLY' : 'Fixture ready' } as const;
}

const model: LanguageModelV3 = {
  specificationVersion: 'v3',
  provider: 'fixture',
  modelId: 'fixture',
  supportedUrls: {},
  async doGenerate(options) {
    const content = plan(options);
    return { content: [content], usage, warnings: [], finishReason: {
      unified: content.type === 'tool-call' ? 'tool-calls' : 'stop', raw: undefined,
    } };
  },
  async doStream(options) {
    const content = plan(options);
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        await new Promise(resolve => setTimeout(resolve, 200));
        if (content.type === 'tool-call') {
          controller.enqueue(content);
        } else {
          controller.enqueue({ type: 'text-start', id: 'reply' });
          controller.enqueue({ type: 'text-delta', id: 'reply', delta: content.text });
          controller.enqueue({ type: 'text-end', id: 'reply' });
        }
        controller.enqueue({ type: 'finish', usage, finishReason: {
          unified: content.type === 'tool-call' ? 'tool-calls' : 'stop', raw: undefined,
        } });
        controller.close();
      },
    });
    return { stream };
  },
};

const approvalAgent = new Agent({
  id: 'approval-fixture',
  name: 'Approval Fixture',
  instructions: 'Call the workflow and respect the decision.',
  model,
  workflows: { approvalWorkflow },
  defaultOptions: { autoResumeSuspendedTools: true },
  memory: new Memory({ options: { lastMessages: 20, observationalMemory: {
    model,
    scope: 'thread',
    observation: { messageTokens: 30_000 },
    reflection: { observationTokens: 40_000 },
  } } }),
});

export const mastra = new Mastra({
  agents: { approvalAgent },
  workflows: { approvalWorkflow },
  storage: new LibSQLStore({ id: 'fixture-storage', url: 'file:./fixture.db' }),
  editor: new MastraEditor(),
  server: { host: '127.0.0.1', port: Number(process.env.APPROVAL_TEST_PORT ?? 4111) },
});


