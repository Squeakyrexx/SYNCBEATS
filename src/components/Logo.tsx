import { Music2 } from 'lucide-react';
import Link from 'next/link';

type LogoProps = {
  size?: 'small' | 'medium' | 'large';
};

export function Logo({ size = 'medium' }: LogoProps) {
  const sizeClasses = {
    small: 'text-2xl',
    medium: 'text-4xl',
    large: 'text-6xl',
  };
  const iconSizeClasses = {
    small: 'h-6 w-6',
    medium: 'h-8 w-8',
    large: 'h-12 w-12',
  }

  return (
    <Link href="/" className="flex items-center gap-2 text-primary hover:text-accent transition-colors duration-300">
      <Music2 className={`${iconSizeClasses[size]} text-accent`} />
      <h1 className={`font-bold ${sizeClasses[size]}`}>
        SyncBeats
      </h1>
    </Link>
  );
}
