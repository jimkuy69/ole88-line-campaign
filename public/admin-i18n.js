(() => {
  const translations = {
    'OLE88 Campaign Manager': 'ตัวจัดการแคมเปญ OLE88',
    'Manage reusable LINE campaigns': 'จัดการแคมเปญ LINE ที่นำกลับมาใช้ได้',
    'Sign out': 'ออกจากระบบ',
    'Sign in to continue.': 'กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ',
    'Admin sign in': 'เข้าสู่ระบบผู้ดูแล',
    'Username': 'ชื่อผู้ใช้',
    'Password': 'รหัสผ่าน',
    'Sign in': 'เข้าสู่ระบบ',
    'ADMIN_ONLY mode is active: LINE processing, delivery, and publishing are disabled. Draft editing, evidence review, and analytics remain available.':
      'เปิดโหมด ADMIN_ONLY: ปิดการประมวลผล LINE การส่งข้อความ และการเผยแพร่แคมเปญ แต่ยังแก้ไขฉบับร่าง ตรวจหลักฐาน และดู Analytics ได้',
    'Analytics & operational dashboard': 'แดชบอร์ด Analytics และการปฏิบัติงาน',
    'Refresh': 'รีเฟรช',
    'Campaign': 'แคมเปญ',
    'All campaigns': 'ทุกแคมเปญ',
    'From': 'ตั้งแต่วันที่',
    'To': 'ถึงวันที่',
    'From (Bangkok)': 'ตั้งแต่วันที่ (เวลาไทย)',
    'To (Bangkok)': 'ถึงวันที่ (เวลาไทย)',
    'Apply': 'ใช้ตัวกรอง',
    'Counts come from PostgreSQL. “Followers” are processed LINE follow events; this system does not measure confirmed campaign views.':
      'ข้อมูลมาจาก PostgreSQL จำนวน “ผู้ติดตาม” นับจากเหตุการณ์ติดตาม LINE ที่ประมวลผลแล้ว ระบบนี้ไม่ได้วัดยอดการเห็นแคมเปญที่ยืนยันแล้ว',
    'Daily activity · Asia/Bangkok': 'กิจกรรมรายวัน · เวลาไทย',
    'Current delivery / webhook statuses': 'สถานะการส่งข้อความ / Webhook ปัจจุบัน',
    'Operational issues · no automatic retries': 'รายการที่ต้องตรวจสอบ · ไม่มีการลองส่งซ้ำอัตโนมัติ',
    'Webhook backlog': 'Webhook ที่ค้าง',
    'Outbound review': 'ตรวจสอบข้อความขาออก',
    'Overdue evidence': 'หลักฐานที่เกินกำหนด',
    'Status filter': 'กรองตามสถานะ',
    'All issue statuses': 'ทุกสถานะ',
    'Showing webhook events across all campaigns; webhook events are not linked to a campaign.':
      'กำลังแสดง Webhook ทุกแคมเปญ เนื่องจาก Webhook ไม่ได้ผูกกับแคมเปญ',
    'Filtered to the selected campaign.': 'กรองตามแคมเปญที่เลือก',
    'Showing all campaigns.': 'กำลังแสดงทุกแคมเปญ',
    'No matching operational issues.': 'ไม่พบรายการที่ตรงกับตัวกรอง',
    'Load more': 'โหลดเพิ่มเติม',
    'No activity in this period.': 'ไม่มีรายการในช่วงเวลานี้',
    'Outbound': 'ข้อความขาออก',
    'Webhooks received in range': 'Webhook ที่ได้รับในช่วงเวลา',
    'No rows': 'ไม่มีข้อมูล',
    'Evidence review queue': 'คิวตรวจสอบหลักฐาน',
    'Status': 'สถานะ',
    'Submitted': 'ส่งแล้ว',
    'Approved': 'อนุมัติแล้ว',
    'Rejected': 'ปฏิเสธแล้ว',
    'All statuses': 'ทุกสถานะ',
    'Filter': 'กรอง',
    'Select evidence to inspect claim, activity and image.':
      'เลือกรายการหลักฐานเพื่อตรวจสอบคำขอ กิจกรรม และรูปภาพ',
    'No matching evidence.': 'ไม่พบหลักฐานที่ตรงกับตัวกรอง',
    'Review': 'ตรวจสอบ',
    'Review note:': 'หมายเหตุการตรวจสอบ:',
    'Required reason when rejecting': 'ระบุเหตุผลเมื่อต้องการปฏิเสธ',
    'Approve': 'อนุมัติ',
    'Reject': 'ปฏิเสธ',
    'Enter a rejection reason.': 'กรุณาระบุเหตุผลในการปฏิเสธ',
    'Evidence changed in another session. Refresh the queue.':
      'หลักฐานถูกเปลี่ยนแปลงจากอีกหน้าต่าง กรุณารีเฟรชคิว',
    'Could not load evidence reviews:': 'โหลดรายการตรวจสอบหลักฐานไม่สำเร็จ:',
    'Could not open review:': 'เปิดรายการตรวจสอบไม่สำเร็จ:',
    'Evidence image could not be loaded. Check your session and refresh the review.':
      'โหลดรูปหลักฐานไม่สำเร็จ กรุณาตรวจสอบการเข้าสู่ระบบและรีเฟรชรายการ',
    'Submitted evidence': 'หลักฐานที่ส่งมา',
    'Hero preview': 'ตัวอย่างรูปภาพหลัก',
    'Evidence was already reviewed or changed. Refreshing.':
      'หลักฐานนี้ถูกตรวจสอบหรือเปลี่ยนแปลงแล้ว กำลังรีเฟรช',
    'Campaigns': 'แคมเปญ',
    'Create from template': 'สร้างจากเทมเพลต',
    'Choose a starting template': 'เลือกเทมเพลตเริ่มต้น',
    'Welcome + Claim — LINE welcome card with a claim postback and an activity list.':
      'ต้อนรับ + รับสิทธิ์ — การ์ดต้อนรับ LINE พร้อมปุ่มรับสิทธิ์และรายการกิจกรรม',
    'Activity challenge — A reusable claim campaign with several activities.':
      'ภารกิจหลายกิจกรรม — แคมเปญรับสิทธิ์ที่นำกลับมาใช้ได้และมีกิจกรรมหลายรายการ',
    'Use template': 'ใช้เทมเพลตนี้',
    'Unique campaign code (letters, numbers, _ or -):': 'รหัสแคมเปญที่ไม่ซ้ำ (ใช้ตัวอักษร ตัวเลข _ หรือ -):',
    'New unique campaign code:': 'รหัสแคมเปญใหม่ที่ไม่ซ้ำ:',
    'Open': 'เปิด',
    'Save draft': 'บันทึกฉบับร่าง',
    'Preview': 'ดูตัวอย่าง',
    'Publish': 'เผยแพร่',
    'Pause': 'พักแคมเปญ',
    'Duplicate': 'ทำสำเนา',
    'Campaign code': 'รหัสแคมเปญ',
    'Name': 'ชื่อ',
    'Template type': 'ประเภทเทมเพลต',
    'Claim policy': 'นโยบายการรับสิทธิ์',
    'Title': 'หัวข้อ',
    'Subtitle': 'คำอธิบายสั้น',
    'Reward type': 'ประเภทของรางวัล',
    'Reward value': 'รายละเอียดรางวัล',
    'Start (ISO date/time)': 'วันเวลาเริ่มต้น',
    'End (ISO date/time)': 'วันเวลาสิ้นสุด',
    'Maximum claims': 'จำนวนสิทธิ์สูงสุด',
    'Hero image HTTPS URL': 'URL รูปภาพหลัก (HTTPS)',
    'Secondary image HTTPS URL': 'URL รูปภาพที่สอง (HTTPS)',
    'Use supplied OLE88 artwork': 'ใช้ภาพ OLE88 ที่ส่งมา',
    'Secondary campaign image preview': 'ตัวอย่างรูปภาพแคมเปญภาพที่สอง',
    'The supplied images are hosted on this staging site. Add image URLs over HTTPS; saving remains a separate action.':
      'ภาพที่เตรียมไว้โฮสต์บน staging นี้ กรอก URL ภาพผ่าน HTTPS; การบันทึกยังต้องกดแยกต่างหาก',
    'https://…': 'https://…',
    'Image upload is not configured. Use an HTTPS image URL publicly reachable by LINE; the editor only previews it locally.':
      'ยังไม่ได้ตั้งค่าการอัปโหลดรูปภาพ โปรดใช้ URL HTTPS ที่ LINE เข้าถึงได้ รูปตัวอย่างในหน้านี้แสดงเฉพาะในเครื่อง',
    'Buttons': 'ปุ่ม',
    'BTN_CLAIM is a permanent key; its campaign-specific postback is generated automatically.':
      'BTN_CLAIM เป็นรหัสถาวร ระบบสร้าง postback เฉพาะแคมเปญให้อัตโนมัติ',
    'Add button': 'เพิ่มปุ่ม',
    'Activities': 'กิจกรรม',
    'Add activity': 'เพิ่มกิจกรรม',
    'Messages': 'ข้อความ',
    'Welcome message': 'ข้อความต้อนรับ',
    'Claim created': 'สร้างคำขอรับสิทธิ์แล้ว',
    'Already claimed': 'รับสิทธิ์ไปแล้ว',
    'Claim status: in progress': 'สถานะคำขอ: กำลังดำเนินการ',
    'Claim status: under review': 'สถานะคำขอ: รอตรวจสอบ',
    'Claim status: approved': 'สถานะคำขอ: อนุมัติแล้ว',
    'Claim status: rejected': 'สถานะคำขอ: ถูกปฏิเสธ',
    'Evidence: select activity': 'หลักฐาน: เลือกกิจกรรม',
    'Evidence: upload prompt': 'หลักฐาน: ข้อความแจ้งให้อัปโหลด',
    'Evidence: received': 'หลักฐาน: ได้รับแล้ว',
    'Evidence: pending review': 'หลักฐาน: รอตรวจสอบ',
    'Evidence: invalid image': 'หลักฐาน: รูปภาพไม่ถูกต้อง',
    'Evidence: approved': 'หลักฐาน: อนุมัติแล้ว',
    'Evidence: rejected (supports {{reason}})': 'หลักฐาน: ปฏิเสธ (ใช้ {{reason}} ได้)',
    ' Enabled': ' เปิดใช้งาน',
    ' Required': ' จำเป็น',
    'Button ID': 'รหัสปุ่ม',
    'Button label': 'ข้อความบนปุ่ม',
    'HTTPS URL or postback': 'URL HTTPS หรือ postback',
    'Activity ID': 'รหัสกิจกรรม',
    'Activity title': 'ชื่อกิจกรรม',
    'Description': 'รายละเอียด',
    'Button': 'ปุ่ม',
    'Activity': 'กิจกรรม',
    'Delete': 'ลบ',
    'Image preview unavailable.': 'ไม่สามารถแสดงตัวอย่างรูปภาพได้',
    'Welcome card preview': 'ตัวอย่างการ์ดต้อนรับ',
    'Claim/activity preview': 'ตัวอย่างคำขอและกิจกรรม',
    'Draft saved.': 'บันทึกฉบับร่างแล้ว',
    'Campaign published.': 'เผยแพร่แคมเปญแล้ว',
    'Campaign editor': 'ตัวแก้ไขแคมเปญ',
    'Changes are saved as a Draft.': 'การเปลี่ยนแปลงจะถูกบันทึกเป็นฉบับร่าง',
    'Active campaigns cannot be edited. Pause the campaign before making changes.':
      'แก้ไขแคมเปญที่กำลังใช้งานไม่ได้ กรุณาพักแคมเปญก่อน',
    'Paused campaign. Save changes as a Draft configuration, then publish again.':
      'แคมเปญถูกพักไว้ บันทึกการเปลี่ยนแปลงเป็นฉบับร่างก่อนเผยแพร่ใหม่',
    'ADMIN_ONLY mode: publishing is disabled; campaign drafts remain editable.':
      'โหมด ADMIN_ONLY: ปิดการเผยแพร่ แต่ยังแก้ไขฉบับร่างได้',
    'Browser error:': 'ข้อผิดพลาดของเบราว์เซอร์:',
    'Admin error:': 'ข้อผิดพลาดของระบบผู้ดูแล:',
    'Admin is temporarily unavailable:': 'ระบบผู้ดูแลไม่พร้อมใช้งานชั่วคราว:',
    'Could not load evidence reviews:': 'โหลดรายการตรวจสอบหลักฐานไม่สำเร็จ:',
    'Could not open review:': 'เปิดรายการตรวจสอบไม่สำเร็จ:',
    'Claim': 'คำขอ',
    'Evidence': 'หลักฐาน',
    'submitted': 'ส่งเมื่อ',
    'Ref': 'อ้างอิง',
    'No error code': 'ไม่มีรหัสข้อผิดพลาด',
    'Duplicate button ID.': 'รหัสปุ่มซ้ำกัน',
    'Duplicate activity ID.': 'รหัสกิจกรรมซ้ำกัน',
    'Duplicate message key.': 'รหัสข้อความซ้ำกัน',
    'DRAFT': 'ฉบับร่าง',
    'ACTIVE': 'กำลังใช้งาน',
    'PAUSED': 'พักไว้',
    'FAILED': 'ล้มเหลว',
    'PROCESSING': 'กำลังประมวลผล',
    'UNCERTAIN': 'ไม่ทราบผลการส่ง',
    'SENDING': 'กำลังส่ง',
    'SUBMITTED': 'ส่งแล้ว',
    'SENT': 'ส่งสำเร็จ',
    'WEBHOOK': 'Webhook',
    'OUTBOUND': 'ข้อความขาออก',
    'REVIEW': 'การตรวจสอบ',
    'Use an HTTPS URL without credentials or private/local host.':
      'โปรดใช้ URL HTTPS ที่ไม่มีข้อมูลเข้าสู่ระบบ และไม่ใช่โฮสต์ภายในหรือส่วนตัว',
    'English': 'English',
    'ไทย': 'ไทย',
  };

  const originals = new WeakMap();
  const lastRendered = new WeakMap();
  const attributeOriginals = new WeakMap();
  let language = localStorage.getItem('ole88-admin-language') === 'en' ? 'en' : 'th';
  let applying = false;

  function translate(value) {
    if (language === 'en') return value;
    if (translations[value] !== undefined) return translations[value];
    const campaignHeading = value.match(/^(.*?) · (DRAFT|ACTIVE|PAUSED) · version (\d+)$/);
    if (campaignHeading) {
      const status = { DRAFT: 'ฉบับร่าง', ACTIVE: 'กำลังใช้งาน', PAUSED: 'พักไว้' }[campaignHeading[2]];
      return `${campaignHeading[1]} · ${status} · เวอร์ชัน ${campaignHeading[3]}`;
    }
    const campaignRow = value.match(/^(.*?) · ([A-Za-z0-9_-]+) · (DRAFT|ACTIVE|PAUSED) · v(\d+)$/);
    if (campaignRow) {
      const status = { DRAFT: 'ฉบับร่าง', ACTIVE: 'กำลังใช้งาน', PAUSED: 'พักไว้' }[campaignRow[3]];
      return `${campaignRow[1]} · ${campaignRow[2]} · ${status} · v${campaignRow[4]}`;
    }
    const issueRow = value.match(/^(WEBHOOK|OUTBOUND|REVIEW) · (.*?) · (FAILED|PROCESSING|UNCERTAIN|SENDING|SUBMITTED)$/);
    if (issueRow) {
      return `${translate(issueRow[1])} · ${translate(issueRow[2])} · ${translate(issueRow[3])}`;
    }
    const referenceRow = value.match(/^Ref (.*?) · (.*?) · (.*)$/);
    if (referenceRow) {
      return `อ้างอิง ${referenceRow[1]} · ${referenceRow[2]} · ${translate(referenceRow[3])}`;
    }
    const claimRow = value.match(/^Claim (.*?) · (.*)$/);
    if (claimRow) return `คำขอ ${claimRow[1]} · ${translate(claimRow[2])}`;
    const evidenceRow = value.match(/^Evidence (.*?) · submitted (.*)$/);
    if (evidenceRow) return `หลักฐาน ${translate(evidenceRow[1])} · ส่งเมื่อ ${evidenceRow[2]}`;
    for (const [english, thai] of Object.entries(translations)) {
      if (english.endsWith(':') && value.startsWith(english)) {
        return `${thai}${value.slice(english.length)}`;
      }
    }
    return value;
  }

  function renderText(node, original) {
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    const content = original.slice(leading.length, original.length - trailing.length || undefined);
    const rendered = `${leading}${translate(content)}${trailing}`;
    lastRendered.set(node, rendered);
    if (node.nodeValue !== rendered) node.nodeValue = rendered;
  }

  function visit(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!originals.has(node)) originals.set(node, node.nodeValue || '');
      renderText(node, originals.get(node));
    }

    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll('*')] : [];
    for (const element of elements) {
      for (const name of ['placeholder', 'title', 'aria-label', 'alt']) {
        if (!element.hasAttribute?.(name)) continue;
        let values = attributeOriginals.get(element);
        if (!values) {
          values = new Map();
          attributeOriginals.set(element, values);
        }
        if (!values.has(name)) values.set(name, element.getAttribute(name) || '');
        element.setAttribute(name, translate(values.get(name)));
      }
    }
  }

  function setLanguage(next) {
    language = next === 'en' ? 'en' : 'th';
    localStorage.setItem('ole88-admin-language', language);
    document.documentElement.lang = language;
    document.title = language === 'th' ? 'ตัวจัดการแคมเปญ OLE88' : 'OLE88 Campaign Manager';
    applying = true;
    visit(document.body);
    const button = document.getElementById('languageToggle');
    if (button) button.textContent = language === 'th' ? 'English' : 'ไทย';
    applying = false;
  }

  const toggle = document.getElementById('languageToggle');
  if (toggle) toggle.addEventListener('click', () => setLanguage(language === 'th' ? 'en' : 'th'));
  document.documentElement.lang = language;
  visit(document.body);
  if (toggle) toggle.textContent = language === 'th' ? 'English' : 'ไทย';

  const observer = new MutationObserver((records) => {
    if (applying) return;
    applying = true;
    for (const record of records) {
      if (record.type === 'characterData' && record.target.nodeType === Node.TEXT_NODE) {
        const current = record.target.nodeValue || '';
        if (lastRendered.get(record.target) !== current) {
          originals.set(record.target, current);
          renderText(record.target, current);
        }
      }
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            originals.set(node, node.nodeValue || '');
            renderText(node, node.nodeValue || '');
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            visit(node);
          }
        }
      }
    }
    applying = false;
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
})();
