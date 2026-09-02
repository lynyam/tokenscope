export function AddMemberForm() {
	return (
		<form>
			<h2>Add member</h2>
			<label htmlFor="member-email">
				Email
			</label>
			<input id="member-email" name="email" type="email"
				placeholder="member@example.com"
				disabled
			/>
			<button type="submit" disabled>
				Add member
			</button>
			<p>
				Adding members will be available in a future update.
			</p>
		</form>
	);
}
