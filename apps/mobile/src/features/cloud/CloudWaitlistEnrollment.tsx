import { useWaitlist } from "@clerk/expo";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useState } from "react";

import { CLOUD_PRODUCT_NAME } from "@kata-sh/code-shared/branding";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { CloudWaitlistJoinRejectedError, joinCloudWaitlist } from "./cloudWaitlistJoin";

// Kata fork delta (KAT-3512): `<Waitlist />` is web-only in Expo, so mobile
// submits early-access requests through Clerk's `useWaitlist()`.
export function CloudWaitlistEnrollment(props: { readonly onSignIn: () => void }) {
  const { errors, fetchStatus, waitlist } = useWaitlist();
  const [emailAddress, setEmailAddress] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const isSubmitting = fetchStatus === "fetching";
  const fieldError = errors.fields.emailAddress?.longMessage;

  const requestEarlyAccess = async () => {
    const normalizedEmailAddress = emailAddress.trim();
    if (!normalizedEmailAddress || isSubmitting) {
      return;
    }

    setRequestError(null);
    try {
      await joinCloudWaitlist(waitlist, normalizedEmailAddress);
    } catch (error) {
      console.error(error);
      setRequestError(
        error instanceof CloudWaitlistJoinRejectedError
          ? "Could not request early access. Check your email address and try again."
          : "Could not request early access. Check your connection and try again.",
      );
    }
  };

  if (waitlist.id) {
    return (
      <View className="gap-[18px]">
        <Text className="text-center font-t3-bold text-xl">You requested early access</Text>
        <Text className="text-center text-base text-foreground-secondary">
          We will email you when your {CLOUD_PRODUCT_NAME} access is ready.
        </Text>
        <SignInAction onPress={props.onSignIn} />
      </View>
    );
  }

  return (
    <View className="gap-[18px]">
      <Text className="text-base text-foreground-secondary">
        {CLOUD_PRODUCT_NAME} is in early access. Enter your email and we will let you know when your
        access is ready.
      </Text>

      <View className="gap-2">
        <Text className="font-t3-bold text-sm text-foreground-secondary">Email address</Text>
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          className={cn("text-lg", (fieldError || requestError) && "border-danger-foreground")}
          keyboardType="email-address"
          onChangeText={(value) => {
            setEmailAddress(value);
            setRequestError(null);
          }}
          onSubmitEditing={() => void requestEarlyAccess()}
          placeholder="Enter your email address"
          returnKeyType="send"
          textContentType="emailAddress"
          value={emailAddress}
        />
        {fieldError || requestError ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-sm text-danger-foreground"
            selectable
          >
            {fieldError ?? requestError}
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          busy: isSubmitting,
          disabled: isSubmitting || emailAddress.trim().length === 0,
        }}
        disabled={isSubmitting || emailAddress.trim().length === 0}
        onPress={() => void requestEarlyAccess()}
        className="min-h-[54px] flex-row items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 disabled:opacity-[0.45]"
      >
        {isSubmitting ? (
          <ActivityIndicator colorClassName="accent-primary-foreground" size="small" />
        ) : null}
        <Text className="font-t3-bold text-base text-primary-foreground">
          {isSubmitting ? "Requesting" : "Request early access"}
        </Text>
      </Pressable>

      <SignInAction onPress={props.onSignIn} />
    </View>
  );
}

function SignInAction(props: { readonly onPress: () => void }) {
  return (
    <View className="flex-row items-center justify-center gap-1 pt-1">
      <Text className="text-base text-foreground-secondary">Already approved?</Text>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={props.onPress}>
        <Text className="font-t3-bold text-base">Sign in</Text>
      </Pressable>
    </View>
  );
}
