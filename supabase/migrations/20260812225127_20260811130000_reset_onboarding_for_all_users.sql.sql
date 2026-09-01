/*
# Reset onboarding for all existing users

Sets onboarding_completed = false for every profile so that existing users
see the step-by-step walkthrough on their next visit. They can dismiss it
permanently by checking "Don't show again" on the last step.
*/

UPDATE profiles SET onboarding_completed = false;