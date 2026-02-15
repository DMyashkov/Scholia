import { Plus } from 'lucide-react';

interface WelcomeScreenProps {
  onAddSource: () => void;
  hasSources: boolean;
}

export const WelcomeScreen = ({ onAddSource, hasSources }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full space-y-8 animate-fade-in text-center">
        {/* Logo and title */}
        <div className="space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-4">
            <span className="text-3xl font-serif text-gradient">S</span>
          </div>
          <h1 className="text-4xl font-serif text-foreground">
            Welcome to <span className="text-gradient">Scholia</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Get evidence-backed answers from your sources. Add a webpage or document to get started.
          </p>
        </div>

        {/* CTA - only when no sources yet */}
        {!hasSources && (
          <button
            onClick={onAddSource}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
          >
            <Plus className="h-5 w-5" />
            Add your first source
          </button>
        )}
      </div>
    </div>
  );
};
