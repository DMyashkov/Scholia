import { DiscoveredPage, Quote } from '@/types/source';

// Mock page content for sources
export const mockPageContents: Record<string, string> = {
  'stripe-pricing': `
Stripe Pricing Guide

Stripe offers transparent, pay-as-you-go pricing with no setup fees, monthly fees, or hidden fees. 

Payment Processing Fees:
Our standard pricing is 2.9% + 30¢ per successful card charge. This rate applies to most businesses processing under $1M annually.

Volume Discounts:
For businesses processing more than $1M annually, we offer custom pricing packages. Contact our sales team for enterprise rates starting at 2.2% + 30¢.

International Cards:
An additional 1.5% fee applies to cards issued outside your country. Currency conversion adds 1% on top of the standard fee.

Invoicing:
Stripe Invoicing starts at 0.4% per paid invoice (capped at $2 for invoices under $500). Premium features include automated reminders and custom branding.
  `,
  'stripe-auth': `
Stripe Authentication & Security

Two-Factor Authentication:
All Stripe accounts support two-factor authentication (2FA). We strongly recommend enabling 2FA for all team members with Dashboard access.

API Keys:
Your API keys carry many privileges, so be sure to keep them secure. Don't share your secret API key in publicly accessible areas such as GitHub or client-side code.

Webhook Signatures:
Stripe signs webhook events with a signature you can verify to ensure the event was sent by Stripe. Each endpoint has a unique signing secret.

PCI Compliance:
Stripe handles all card data, which means your integration can operate with reduced PCI scope. Using Stripe Elements or Checkout keeps you PCI compliant with minimal effort.
  `,
  'stripe-api': `
Stripe API Reference

Getting Started:
The Stripe API is organized around REST. Our API has predictable resource-oriented URLs, accepts form-encoded request bodies, returns JSON-encoded responses.

Authentication:
The Stripe API uses API keys to authenticate requests. You can view and manage your API keys in the Stripe Dashboard.

Rate Limits:
The API rate limits requests at 100 requests per second. If you exceed this limit, you'll receive a 429 Too Many Requests response.

Pagination:
All top-level API resources have support for bulk fetches via list API methods. These list API methods share a common structure, taking at least these three parameters: limit, starting_after, and ending_before.
  `,
  'supabase-auth': `
Supabase Authentication

Built-in Auth:
Supabase Auth provides a complete user management system with support for email/password, magic links, and OAuth providers.

Row Level Security:
Combine authentication with Postgres Row Level Security to create secure applications. RLS policies determine which rows users can access.

Session Management:
Sessions are managed automatically with secure httpOnly cookies. Access tokens expire after 1 hour by default, with automatic refresh token rotation.

OAuth Providers:
Supabase supports 30+ OAuth providers including Google, GitHub, Discord, and Apple. Configuration is done via the Dashboard.
  `,
  'supabase-database': `
Supabase Database

PostgreSQL:
Every Supabase project is a full Postgres database. You get all the power of Postgres with extensions like PostGIS, pgvector, and more.

Realtime:
Listen to database changes in realtime using Supabase Realtime. Subscribe to INSERT, UPDATE, and DELETE events on any table.

Database Functions:
Write server-side functions using PL/pgSQL. These functions can be called via the API or triggered by database events.

Connection Pooling:
Supabase uses PgBouncer for connection pooling. This allows thousands of simultaneous connections without overwhelming your database.
  `,
  'supabase-pricing': `
Supabase Pricing

Free Tier:
Get started for free with 500MB database, 1GB file storage, 50,000 monthly active users, and 500,000 edge function invocations.

Pro Plan ($25/month):
Includes 8GB database, 100GB file storage, unlimited MAUs, 2M edge function invocations, and daily backups.

Team Plan ($599/month):
Everything in Pro plus SOC2 Type II compliance, SSO, priority support, and SLAs.

Enterprise:
Custom pricing for organizations requiring dedicated infrastructure, advanced security, and white-glove support.
  `,
};

// Generate mock discovered pages for a domain
export const generateMockPages = (domain: string, status: 'ready' | 'crawling'): DiscoveredPage[] => {
  const pagesMap: Record<string, { title: string; path: string; contentKey: string }[]> = {
    'stripe.com': [
      { title: 'Pricing & Fees', path: '/pricing', contentKey: 'stripe-pricing' },
      { title: 'Authentication Guide', path: '/docs/authentication', contentKey: 'stripe-auth' },
      { title: 'API Reference', path: '/docs/api', contentKey: 'stripe-api' },
      { title: 'Getting Started', path: '/docs/get-started', contentKey: 'stripe-api' },
      { title: 'Webhooks', path: '/docs/webhooks', contentKey: 'stripe-auth' },
    ],
    'supabase.com': [
      { title: 'Authentication', path: '/docs/guides/auth', contentKey: 'supabase-auth' },
      { title: 'Database', path: '/docs/guides/database', contentKey: 'supabase-database' },
      { title: 'Pricing', path: '/pricing', contentKey: 'supabase-pricing' },
      { title: 'Row Level Security', path: '/docs/guides/auth/row-level-security', contentKey: 'supabase-auth' },
      { title: 'Realtime', path: '/docs/guides/realtime', contentKey: 'supabase-database' },
    ],
    'default': [
      { title: 'Home', path: '/', contentKey: 'stripe-api' },
      { title: 'Documentation', path: '/docs', contentKey: 'stripe-api' },
      { title: 'Getting Started', path: '/docs/getting-started', contentKey: 'stripe-api' },
    ],
  };

  const pages = pagesMap[domain] || pagesMap['default'];
  
  return pages.map((page, index) => ({
    id: `${domain}-page-${index}`,
    title: page.title,
    path: page.path,
    status: status === 'ready' ? 'indexed' : (index < 2 ? 'indexed' : 'pending'),
    content: mockPageContents[page.contentKey],
  }));
};

// Generate quotes based on user message keywords
export const generateQuotesForMessage = (
  userMessage: string,
  sources: { id: string; domain: string; pages: DiscoveredPage[] }[]
): Quote[] => {
  const lowerMessage = userMessage.toLowerCase();
  const quotes: Quote[] = [];

  const keywordQuotes: Record<string, { snippet: string; pageTitle: string; pagePath: string }[]> = {
    pricing: [
      {
        snippet: 'Our standard pricing is 2.9% + 30¢ per successful card charge. This rate applies to most businesses processing under $1M annually.',
        pageTitle: 'Pricing & Fees',
        pagePath: '/pricing',
      },
      {
        snippet: 'Get started for free with 500MB database, 1GB file storage, 50,000 monthly active users, and 500,000 edge function invocations.',
        pageTitle: 'Pricing',
        pagePath: '/pricing',
      },
    ],
    auth: [
      {
        snippet: 'All Stripe accounts support two-factor authentication (2FA). We strongly recommend enabling 2FA for all team members with Dashboard access.',
        pageTitle: 'Authentication Guide',
        pagePath: '/docs/authentication',
      },
      {
        snippet: 'Supabase Auth provides a complete user management system with support for email/password, magic links, and OAuth providers.',
        pageTitle: 'Authentication',
        pagePath: '/docs/guides/auth',
      },
    ],
    api: [
      {
        snippet: 'The Stripe API is organized around REST. Our API has predictable resource-oriented URLs, accepts form-encoded request bodies, returns JSON-encoded responses.',
        pageTitle: 'API Reference',
        pagePath: '/docs/api',
      },
      {
        snippet: 'The API rate limits requests at 100 requests per second. If you exceed this limit, you\'ll receive a 429 Too Many Requests response.',
        pageTitle: 'API Reference',
        pagePath: '/docs/api',
      },
    ],
    database: [
      {
        snippet: 'Every Supabase project is a full Postgres database. You get all the power of Postgres with extensions like PostGIS, pgvector, and more.',
        pageTitle: 'Database',
        pagePath: '/docs/guides/database',
      },
      {
        snippet: 'Listen to database changes in realtime using Supabase Realtime. Subscribe to INSERT, UPDATE, and DELETE events on any table.',
        pageTitle: 'Realtime',
        pagePath: '/docs/guides/realtime',
      },
    ],
    security: [
      {
        snippet: 'Combine authentication with Postgres Row Level Security to create secure applications. RLS policies determine which rows users can access.',
        pageTitle: 'Row Level Security',
        pagePath: '/docs/guides/auth/row-level-security',
      },
      {
        snippet: 'Stripe signs webhook events with a signature you can verify to ensure the event was sent by Stripe. Each endpoint has a unique signing secret.',
        pageTitle: 'Webhooks',
        pagePath: '/docs/webhooks',
      },
    ],
  };

  // Find matching keywords
  const matchedKeywords: string[] = [];
  for (const keyword of Object.keys(keywordQuotes)) {
    if (lowerMessage.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }

  // If no specific keywords, pick a random one
  if (matchedKeywords.length === 0 && sources.length > 0) {
    const allKeywords = Object.keys(keywordQuotes);
    matchedKeywords.push(allKeywords[Math.floor(Math.random() * allKeywords.length)]);
  }

  // Generate quotes from available sources
  for (const keyword of matchedKeywords) {
    const keywordData = keywordQuotes[keyword];
    for (const source of sources.slice(0, 2)) {
      const quoteData = keywordData[Math.floor(Math.random() * keywordData.length)];
      const matchingPage = source.pages.find(p => p.path === quoteData.pagePath);
      
      quotes.push({
        id: `quote-${source.id}-${Math.random().toString(36).substr(2, 9)}`,
        sourceId: source.id,
        pageId: matchingPage?.id || `${source.domain}-page-0`,
        snippet: quoteData.snippet,
        pageTitle: quoteData.pageTitle,
        pagePath: quoteData.pagePath,
        domain: source.domain,
      });
      
      if (quotes.length >= 2) break;
    }
    if (quotes.length >= 2) break;
  }

  return quotes;
};

// Mock response that incorporates quotes
export const generateSourcedResponse = (
  userMessage: string,
  hasReadySources: boolean,
  hasCrawlingSources: boolean
): string => {
  if (!hasReadySources && !hasCrawlingSources) {
    return "I'd be happy to help you explore this topic! However, I notice you haven't attached any sources yet.\n\n**Tip:** Attach a source to enable evidence-backed quotes and citations. Click the \"+ Add source\" button above to get started with research-grade answers.";
  }

  if (!hasReadySources && hasCrawlingSources) {
    return "I'm currently indexing your sources to provide evidence-backed answers. Once indexing completes, I'll be able to cite specific passages and provide verifiable quotes.\n\n**Status:** Indexing in progress... Feel free to ask your question, and I'll answer with the best available information.";
  }

  const responses = [
    "Based on my analysis of your attached sources, here's what I found:\n\nThe documentation provides clear guidance on this topic. I've identified key passages that directly address your question.\n\nSee the evidence cards below for specific citations you can verify.",
    "Great question! Let me synthesize the relevant information from your sources.\n\nThe attached documentation covers this comprehensively. I've extracted the most relevant quotes that directly answer your query.\n\nReview the cited evidence below for full context.",
    "I've analyzed your sources and found several relevant passages.\n\nThe information you're looking for is well-documented across the attached materials. Below are the key citations that support this answer.\n\nClick any quote card to see the full context.",
  ];

  return responses[Math.floor(Math.random() * responses.length)];
};
