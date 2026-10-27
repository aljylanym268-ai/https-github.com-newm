-- Simulate: does a real authenticated insert pass the policy? Test with auth.uid() as any real user
SELECT count(*) AS users_with_accounts FROM auth.users;
SELECT count(*) AS existing_subs FROM public.push_subscriptions;
