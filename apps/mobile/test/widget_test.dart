import 'package:didar_mobile/main.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('DidarApp renders the home page app bar title', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: DidarApp()));

    expect(find.text('دیدار'), findsWidgets);
  });
}
