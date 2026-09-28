import { useAuth } from "@clerk/expo";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { CloudWaitlistEnrollment } from "../cloud/CloudWaitlistEnrollment";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { SettingsScreen } from "./components/SettingsScreen";

// Kata fork delta (KAT-3512): signed-out users request Kata Code Connect early
// access here; approved users continue to sign-in from the same screen.
export function SettingsWaitlistRouteScreen() {
  const navigation = useNavigation();

  useFocusEffect(
    useCallback(() => {
      if (!hasCloudPublicConfig()) {
        navigation.dispatch(StackActions.popTo("Settings"));
      }
    }, [navigation]),
  );

  return hasCloudPublicConfig() ? <ConfiguredSettingsWaitlistRouteScreen /> : null;
}

function ConfiguredSettingsWaitlistRouteScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      if (isLoaded && isSignedIn) {
        navigation.dispatch(StackActions.popTo("Settings"));
      }
    }, [isLoaded, isSignedIn, navigation]),
  );

  return (
    <SettingsScreen title="Early access">
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <CloudWaitlistEnrollment
          onSignIn={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
        />
      </ScrollView>
    </SettingsScreen>
  );
}
