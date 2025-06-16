' 测试各种 if-then 语句的情况

' 1. 单行 if 语句
If x > 10 Then Print "x is greater than 10"

' 2. 多行 if 语句
If y < 5 Then
    Print "y is less than 5"
End If

' 3. 同一行包含 If 和 End If 的情况
If z = 0 Then Print "z is zero" End If

' 4. 嵌套 if 语句
If a > 0 Then
    Print "a is positive"
    If b > 0 Then
        Print "b is also positive"
    End If
End If

' 5. 带有 Else 的 if 语句
If c = 1 Then
    Print "c is 1"
Else
    Print "c is not 1"
End If

' 6. 带有 ElseIf 的 if 语句
If d < 0 Then
    Print "d is negative"
ElseIf d = 0 Then
    Print "d is zero"
Else
    Print "d is positive"
End If

' 7. 单行 if 语句中包含注释
If e > 100 Then Print "e is large" ' 这是一个注释

' 8. 单行 if 语句后跟多行 if 语句
If f = 1 Then Print "f is 1"
If g = 2 Then
    Print "g is 2"
End If

' 9. 不完整的 if 语句（缺少 End If）
If h > 0 Then
    Print "h is positive"
    ' 这里缺少 End If

' 10. 不匹配的 if 语句（使用 Wend 而不是 End If）
If i < 10 Then
    Print "i is less than 10"
Wend