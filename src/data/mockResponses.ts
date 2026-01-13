export const mockResponses: string[] = [
  "That's an excellent question! The concept you're asking about has deep roots in both philosophy and modern science. Let me break it down for you in a way that connects these perspectives.\n\nFirst, it's important to understand that knowledge itself is a complex tapestry woven from observation, reasoning, and accumulated wisdom. The ancient scholars understood this intuitively, even without our modern tools.\n\nIn practical terms, this means we should approach such questions with both rigor and humility.",
  
  "I'd be happy to help you explore this topic! Here's what I can tell you:\n\n**Key Points:**\n- The fundamental principle here is interconnectedness\n- Historical precedents show us patterns worth noting\n- Modern research continues to validate classical intuitions\n\nWould you like me to elaborate on any of these aspects?",
  
  "This is a fascinating area of inquiry. The scholarly consensus has evolved significantly over the past century, and I think it's worth examining both traditional and contemporary perspectives.\n\nThe core insight is that complexity often emerges from simple underlying rules. This principle applies across disciplines—from natural sciences to social dynamics.\n\nWhat specific aspect would you like to explore further?",
  
  "Great question! Let me provide you with a comprehensive overview:\n\n1. **Historical Context**: Understanding where we came from helps illuminate where we're going\n2. **Current State**: The field has matured considerably\n3. **Future Directions**: Several promising avenues are being explored\n\nEach of these deserves careful consideration. The interplay between them reveals patterns that might otherwise remain hidden.",
  
  "I appreciate your curiosity about this subject. It touches on some fundamental questions that scholars have grappled with for centuries.\n\nThe answer isn't straightforward, but that's what makes it intellectually rewarding. Consider this: every major breakthrough in understanding has come from questioning assumptions we didn't even realize we were making.\n\nShall I suggest some resources for deeper exploration?",
];

export const getRandomResponse = (): string => {
  return mockResponses[Math.floor(Math.random() * mockResponses.length)];
};

export const generateTitle = (firstMessage: string): string => {
  const words = firstMessage.split(' ').slice(0, 5).join(' ');
  return words.length > 30 ? words.substring(0, 30) + '...' : words;
};
