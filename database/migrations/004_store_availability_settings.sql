-- Store availability and reply-time settings for existing Sar Pay Zone databases.
ALTER TABLE sellers ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1));
ALTER TABLE sellers ADD COLUMN accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0, 1));
ALTER TABLE sellers ADD COLUMN reply_time_minutes INTEGER NOT NULL DEFAULT 60 CHECK (reply_time_minutes >= 0);
ALTER TABLE sellers ADD COLUMN reply_time_text TEXT DEFAULT 'Usually replies within 1 hour';
ALTER TABLE sellers ADD COLUMN closed_message TEXT DEFAULT 'ဆိုင်ခေတ္တပိတ်ထားပါတယ်။ ပြန်ဖွင့်ချိန်တွင် အော်ဒါလက်ခံပါမယ်။';
ALTER TABLE sellers ADD COLUMN auto_reply_message TEXT DEFAULT 'မင်္ဂလာပါ။ စာပေဇုန်ဆိုင်မှ မကြာမီ ပြန်လည်ဖြေကြားပေးပါမယ်။';
