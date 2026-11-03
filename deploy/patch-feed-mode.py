from pathlib import Path

p = Path(r"C:\Users\86152\Desktop\小程序----前沿社\admin\src\views\Events.vue")
tn = p.read_text(encoding="utf-8").replace("\r\n", "\n")


def sub(old: str, new: str, label: str) -> None:
    global tn
    if old not in tn:
        raise SystemExit(f"{label} missing")
    tn = tn.replace(old, new, 1)
    print("ok", label)


sub(
    """function openEdit(row) {
  Object.assign(form, {
    ...emptyForm(),
    ...row,
    startAt: utcToBeijingPicker(row.startAt),
    endAt: utcToBeijingPicker(row.endAt),
    registerDeadline: utcToBeijingPicker(row.registerDeadline),
  });
  showUrlInput.value = false;
  coverBroken.value = false;
  visible.value = true;
}""",
    """function openEdit(row) {
  Object.assign(form, {
    ...emptyForm(),
    ...row,
    startAt: utcToBeijingPicker(row.startAt),
    endAt: utcToBeijingPicker(row.endAt),
    registerDeadline: utcToBeijingPicker(row.registerDeadline),
  });
  applyFeedMode(form, feedModeOf(row));
  showUrlInput.value = false;
  coverBroken.value = false;
  visible.value = true;
}""",
    "openEdit",
)

sub(
    """    const payload = {
      ...form,
      startAt: beijingPickerToUtc(form.startAt),
      endAt: beijingPickerToUtc(form.endAt),
      registerDeadline: beijingPickerToUtc(form.registerDeadline),
    };
    delete payload.id;""",
    """    applyFeedMode(form, form.feedMode);
    const payload = {
      ...form,
      startAt: beijingPickerToUtc(form.startAt),
      endAt: beijingPickerToUtc(form.endAt),
      registerDeadline: beijingPickerToUtc(form.registerDeadline),
    };
    delete payload.id;
    delete payload.feedMode;""",
    "save",
)

sub(
    "await api.put(`/admin/events/${row.id}`, { status: 'closed', showInFeed: false });",
    "await api.put(`/admin/events/${row.id}`, { status: 'closed', showInFeed: false, feedPin: false });",
    "endEvent",
)

sub(
    """async function setShowInFeed(row, showInFeed) {
  try {
    await api.put(`/admin/events/${row.id}`, { showInFeed: Boolean(showInFeed) });
    row.showInFeed = Boolean(showInFeed);
    ElMessage.success(showInFeed ? '已展示到信息流' : '已从信息流移除');
  } catch (e) {
    ElMessage.error(e?.message || '更新失败');
  }
}""",
    """async function setFeedMode(row, mode) {
  try {
    const next = { showInFeed: false, feedPin: false };
    applyFeedMode(next, mode);
    await api.put(`/admin/events/${row.id}`, {
      showInFeed: next.showInFeed,
      feedPin: next.feedPin,
    });
    row.showInFeed = next.showInFeed;
    row.feedPin = next.feedPin;
    const tip =
      mode === 'pin' ? '已置顶到信息流' : mode === 'timeline' ? '已按日期插入信息流' : '已从信息流移除';
    ElMessage.success(tip);
  } catch (e) {
    ElMessage.error(e?.message || '更新失败');
  }
}""",
    "setFeedMode",
)

p.write_text(tn, encoding="utf-8", newline="\n")
print("written")
