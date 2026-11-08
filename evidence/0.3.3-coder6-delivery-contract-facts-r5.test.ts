import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server';
import { createApplicationClient } from '../client/applicationClient';
import { parseCliArgs } from '../cli/commands';
import { applicationContracts, applicationMethods } from '../src/shared/application';
import { settingDefinitions } from '../src/shared/settings';

it('delivery facts: runtime MCP tools equal all 41 application methods and invented CLI commands reject', async () => {
  const transport = createApplicationClient({
    send: async () => { throw new Error('READ_ONLY_ENUMERATION_MUST_NOT_SEND_APPLICATION_REQUESTS'); },
  });
  const server = createServer(transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'coder6-delivery-facts', version: '0.3.3' });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  try {
    const { tools } = await mcp.listTools();
    const methods = [...applicationMethods].sort();
    expect(tools.map(tool => tool.name).sort()).toEqual(methods);
    expect(methods).toHaveLength(41);
    const readCount = applicationMethods.filter(method => applicationContracts[method].readOnly).length;
    expect(readCount).toBe(11);
    expect(methods.length - readCount).toBe(30);
    for (const method of ['create_idea', 'get_idea_details', 'update_idea', 'create_task', 'convert_idea_to_task']) {
      expect(methods).toContain(method);
    }
    for (const method of ['delete_idea', 'update_settings']) expect(methods).not.toContain(method);
    const rejectedCommands: string[][] = [];
    for (const command of [
      ['settings', 'show'],
      ['settings', 'set', '--main-tasks', '5'],
      ['idea', 'delete', '11111111-2222-4333-8444-555555555555'],
      ['find', '--include-idea-details'],
    ]) {
      await expect(parseCliArgs(command)).rejects.toThrow();
      rejectedCommands.push(command);
    }
    const facts = {
      at: new Date().toISOString(),
      methodology: 'Runtime MCP SDK listTools over InMemoryTransport and production CLI parser; no application writes or native pipe calls.',
      applicationMethodCount: methods.length,
      readCount,
      writeCount: methods.length - readCount,
      mcpToolCount: tools.length,
      methods,
      mainTasks: settingDefinitions.mainTasks,
      rejectedCommands,
    };
    writeFileSync(join(process.cwd(), 'evidence/0.3.3-coder6-delivery-contract-facts-r5.json'), `${JSON.stringify(facts, null, 2)}\n`);
    console.log('DELIVERY_FACTS', JSON.stringify(facts));
  } finally {
    await mcp.close();
    await server.close();
  }
});
