import { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import {
  ThreadMarkdownImageView,
  type ThreadMarkdownImageRequestCallbacks,
} from "../threads/ThreadFeed";

type RaceCase = "late-success" | "late-error";
type RaceSource = "a" | "b";

interface RacePhase {
  readonly raceCase: RaceCase;
  readonly source: RaceSource;
}

const fixtureOrigin = process.env.EXPO_PUBLIC_MARKDOWN_IMAGE_RACE_ORIGIN;
const fixtureRunId = process.env.EXPO_PUBLIC_MARKDOWN_IMAGE_RACE_RUN_ID;

function imageUri(phase: RacePhase): string | null {
  if (!fixtureOrigin || !fixtureRunId) return null;
  return `${fixtureOrigin}/runs/${encodeURIComponent(fixtureRunId)}/${phase.raceCase}/${phase.source}.png`;
}

export function MarkdownImageRaceFixture() {
  const callbacksByUri = useRef(new Map<string, ThreadMarkdownImageRequestCallbacks>());
  const [phase, setPhase] = useState<RacePhase>({
    raceCase: "late-success",
    source: "a",
  });
  const uri = imageUri(phase);
  const testID = `markdown-image-race-${phase.raceCase}-${phase.source}`;

  if (uri === null) {
    return (
      <View className="flex-1 items-center justify-center bg-screen p-6">
        <Text className="text-center text-base text-danger">
          Markdown image race fixture configuration is missing.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center gap-6 bg-screen p-6" testID="markdown-image-race">
      <Text className="text-center text-lg font-bold text-foreground">
        {phase.raceCase} image {phase.source.toUpperCase()}
      </Text>
      <ThreadMarkdownImageView
        uri={uri}
        sourceKey={uri}
        unavailable={false}
        alt={`${phase.raceCase} image ${phase.source.toUpperCase()}`}
        title={null}
        onPressImage={() => undefined}
        testID={testID}
        onRequestCallbacks={(requestUri, callbacks) => {
          callbacksByUri.current.set(requestUri, callbacks);
        }}
      />
      {phase.source === "a" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Replace image A with image B"
          className="self-center rounded-full bg-primary px-5 py-3"
          testID="markdown-image-race-replace"
          onPress={() => setPhase({ ...phase, source: "b" })}
        >
          <Text className="font-bold text-primary-foreground">Replace with image B</Text>
        </Pressable>
      ) : null}
      {phase.raceCase === "late-success" && phase.source === "b" ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dispatch late success callback for image A"
            className="self-center rounded-full bg-primary px-5 py-3"
            testID="markdown-image-race-dispatch-late-success"
            onPress={() => {
              const staleUri = imageUri({ raceCase: "late-success", source: "a" });
              if (staleUri) callbacksByUri.current.get(staleUri)?.load({ width: 80, height: 320 });
            }}
          >
            <Text className="font-bold text-primary-foreground">Dispatch late A success</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start late error case"
            className="self-center rounded-full bg-primary px-5 py-3"
            testID="markdown-image-race-start-late-error"
            onPress={() => setPhase({ raceCase: "late-error", source: "a" })}
          >
            <Text className="font-bold text-primary-foreground">Start late error case</Text>
          </Pressable>
        </>
      ) : null}
      {phase.raceCase === "late-error" && phase.source === "b" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dispatch late error callback for image A"
          className="self-center rounded-full bg-primary px-5 py-3"
          testID="markdown-image-race-dispatch-late-error"
          onPress={() => {
            const staleUri = imageUri({ raceCase: "late-error", source: "a" });
            if (staleUri) callbacksByUri.current.get(staleUri)?.error();
          }}
        >
          <Text className="font-bold text-primary-foreground">Dispatch late A error</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
