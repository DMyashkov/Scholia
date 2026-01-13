import { BookOpen, Lightbulb, History, Compass } from 'lucide-react';

interface WelcomeScreenProps {
  onExampleClick: (text: string) => void;
}

const examples = [
  {
    icon: BookOpen,
    title: 'Explain a concept',
    prompt: 'Explain the difference between philosophy and science',
  },
  {
    icon: Lightbulb,
    title: 'Generate ideas',
    prompt: 'What are some creative ways to learn a new language?',
  },
  {
    icon: History,
    title: 'Explore history',
    prompt: 'Tell me about the Renaissance and its impact on art',
  },
  {
    icon: Compass,
    title: 'Get guidance',
    prompt: 'How can I develop better critical thinking skills?',
  },
];

export const WelcomeScreen = ({ onExampleClick }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8 animate-fade-in">
        {/* Logo and title */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-4">
            <span className="text-3xl font-serif text-gradient">S</span>
          </div>
          <h1 className="text-4xl font-serif text-foreground">
            Welcome to <span className="text-gradient">Scholia</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Your scholarly companion for exploring ideas, understanding concepts, and discovering knowledge.
          </p>
        </div>

        {/* Example prompts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {examples.map((example, index) => (
            <button
              key={index}
              onClick={() => onExampleClick(example.prompt)}
              className="group flex items-start gap-3 p-4 rounded-xl bg-secondary/50 hover:bg-secondary border border-transparent hover:border-border transition-all text-left"
            >
              <div className="shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <example.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground mb-1">
                  {example.title}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {example.prompt}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
