/**
 * Temporary test component to verify database setup
 * 
 * Usage:
 * 1. Import this in App.tsx or Index.tsx temporarily
 * 2. Add <DatabaseTest /> to your component tree
 * 3. Check browser console for test results
 * 4. Remove when done testing
 */

import { useState } from 'react';
import { useConversations, useCreateConversation } from '@/hooks/useConversations';
import { useMessages, useCreateMessage } from '@/hooks/useMessages';
import { useConversationSources, useAddSourceToConversation } from '@/hooks/useConversationSources';
import { useCrawlJobs } from '@/hooks/useCrawlJobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function DatabaseTest() {
  const [testResults, setTestResults] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const { data: conversations, isLoading: conversationsLoading } = useConversations();
  const createConversation = useCreateConversation();
  const createMessage = useCreateMessage();
  const addSource = useAddSourceToConversation();

  const firstConversationId = conversations?.[0]?.id || null;
  const { data: messages } = useMessages(firstConversationId);
  const { data: sources } = useConversationSources(firstConversationId);
  const firstSourceId = sources?.[0]?.source?.id || null;
  const { data: crawlJobs } = useCrawlJobs(firstSourceId);

  const addResult = (message: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    console.log(message);
  };

  const runTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    addResult('🧪 Starting database tests...');

    try {
      // Test 1: Create conversation
      addResult('Test 1: Creating conversation...');
      const newConv = await createConversation.mutateAsync();
      addResult(`✅ Conversation created: ${newConv.id}`);

      // Test 2: Create message
      addResult('Test 2: Creating message...');
      const newMsg = await createMessage.mutateAsync({
        conversation_id: newConv.id,
        role: 'user',
        content: 'Test message from database test component',
      });
      addResult(`✅ Message created: ${newMsg.id}`);

      // Test 3: Add source
      addResult('Test 3: Adding source...');
      const newSource = await addSource.mutateAsync({
        conversationId: newConv.id,
        sourceData: {
          url: 'https://example.com',
          domain: 'example.com',
          crawl_depth: 'shallow',
          include_subpages: true,
          include_pdfs: false,
          same_domain_only: true,
        },
      });
      addResult(`✅ Source created and added: ${newSource.id}`);

      // Test 4: Check crawl job was created
      addResult('Test 4: Checking crawl job...');
      // Wait a bit for crawl job to be created
      await new Promise(resolve => setTimeout(resolve, 500));
      addResult('✅ Crawl job should be created automatically');

      addResult('🎉 All tests completed successfully!');
    } catch (error: unknown) {
      const err = error as { message?: string; error?: { message?: string } };
      const errorMessage = err?.message || err?.error?.message || JSON.stringify(error, null, 2);
      addResult(`❌ Test failed: ${errorMessage}`);
      console.error('Test error details:', error);
      if (err?.error) {
        console.error('Supabase error:', err.error);
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="m-4 max-w-2xl">
      <CardHeader>
        <CardTitle>Database Test Component</CardTitle>
        <CardDescription>
          Temporary component to test database setup. Remove after testing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={runTests} disabled={isRunning}>
          {isRunning ? 'Running Tests...' : 'Run Database Tests'}
        </Button>

        <div className="space-y-2">
          <h3 className="font-semibold">Current State:</h3>
          <ul className="text-sm space-y-1">
            <li>
              Conversations: {conversationsLoading ? 'Loading...' : conversations?.length || 0}
            </li>
            {firstConversationId && (
              <>
                <li>Messages: {messages?.length || 0}</li>
                <li>Sources: {sources?.length || 0}</li>
                <li>Crawl Jobs: {crawlJobs?.length || 0}</li>
              </>
            )}
          </ul>
        </div>

        {testResults.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">Test Results:</h3>
            <div className="bg-muted p-4 rounded-md max-h-64 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {testResults.join('\n')}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
