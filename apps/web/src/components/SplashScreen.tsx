import { AppMark } from "./AppMark";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="KataCode splash screen">
        <AppMark className="size-16 object-contain" />
      </div>
    </div>
  );
}
